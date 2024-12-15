const AccountsService = imports.gi.AccountsService;
const Atk = imports.gi.Atk;
const Cinnamon = imports.gi.Cinnamon;
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Clutter = imports.gi.Clutter;
const Gdm = imports.gi.Gdm;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const St = imports.gi.St;

const Batch = imports.ui.unlock.batch;
const UnlockUtil = imports.ui.unlock.util;

const CinnamonEntry = imports.ui.cinnamonEntry;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const Params = imports.misc.params;
const UserWidget = imports.ui.userWidget;

const DATE_FORMAT_FULL = CinnamonDesktop.WallClock.lctime_format("cinnamon", _("%A %B %-e, %Y"));

const CROSSFADE_TIME = 300;

var AuthPromptStatus = {
    NOT_VERIFYING: 0,
    VERIFYING: 1,
    VERIFICATION_FAILED: 2,
    VERIFICATION_SUCCEEDED: 3,
    VERIFICATION_CANCELLED: 4,
    VERIFICATION_IN_PROGRESS: 5,
};

var BeginRequestType = {
    PROVIDE_USERNAME: 0,
    DONT_PROVIDE_USERNAME: 1,
    REUSE_USERNAME: 2,
};

var AuthPrompt = GObject.registerClass({
    Signals: {
        'cancelled': {},
        'failed': {},
        'next': {},
        'prompted': {},
        'reset': { param_types: [GObject.TYPE_UINT] },
        'deactivate': {},
    },
}, class AuthPrompt extends St.BoxLayout {
    _init(gdmClient) {
        super._init({
            style_class: 'login-dialog-prompt-layout',
            vertical: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });

        this.verificationStatus = AuthPromptStatus.NOT_VERIFYING;

        this._gdmClient = gdmClient;
        this._defaultButtonWellActor = null;
        this._cancelledRetries = 0;

        let reauthenticationOnly = true;

        this._userVerifier = new UnlockUtil.CinnamonUserVerifier(this._gdmClient);

        this._userVerifier.connect('ask-question', this._onAskQuestion.bind(this));
        // this._userVerifier.connect('show-message', this._onShowMessage.bind(this));
        // this._userVerifier.connect('verification-failed', this._onVerificationFailed.bind(this));
        // this._userVerifier.connect('verification-complete', this._onVerificationComplete.bind(this));
        this._userVerifier.connect('reset', this._onReset.bind(this));
        // this._userVerifier.connect('smartcard-status-changed', this._onSmartcardStatusChanged.bind(this));
        // this._userVerifier.connect('credential-manager-authenticated', this._onCredentialManagerAuthenticated.bind(this));

        this.connect('destroy', this._onDestroy.bind(this));

        this._userWell = new St.Bin({
            // x_expand: true,
            // y_expand: true,
        });
        this.add_child(this._userWell);

        this._mainBox = new St.BoxLayout({
            style_class: 'login-dialog-button-box',
            vertical: false,
        });
        this.add_child(this._mainBox);

        this.cancelButton = new St.Button({
            style_class: 'modal-dialog-button button cancel-button',
            // label: 'Unlock Me!',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({ icon_name: 'go-previous-symbolic' }),
        });
        this.cancelButton.connect('clicked', () => this.cancel());
        this._mainBox.add_child(this.cancelButton);

        let entryParams = {
            style_class: 'login-dialog-prompt-entry',
            can_focus: true,
            x_expand: true,
        };

        this._entry = null;

        this._textEntry = new St.Entry(entryParams);
        CinnamonEntry.addContextMenu(this._textEntry);

        this._passwordEntry = new St.PasswordEntry(entryParams);
        CinnamonEntry.addContextMenu(this._passwordEntry);

        this._entry = this._passwordEntry;
        this._mainBox.add_child(this._entry);
        this._entry.grab_key_focus();

        this._timedLoginIndicator = new St.Bin({
            style_class: 'login-dialog-timed-login-indicator',
            scale_x: 0,
        });

        this.add_child(this._timedLoginIndicator);

        [this._textEntry, this._passwordEntry].forEach(entry => {
            entry.clutter_text.connect('text-changed', () => {
                if (!this._userVerifier.hasPendingMessages)
                    this._fadeOutMessage();
            });

            entry.clutter_text.connect('activate', () => {
                let shouldSpin = entry === this._passwordEntry;
                if (entry.reactive)
                    this._activateNext(shouldSpin);
            });
        });

        this._defaultButtonWell = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._defaultButtonWell.add_constraint(new Clutter.BindConstraint({
            source: this.cancelButton,
            coordinate: Clutter.BindCoordinate.WIDTH,
        }));
        this._mainBox.add_child(this._defaultButtonWell);

        // this.loginButton = new St.Button({
        //     style_class: 'modal-dialog-button button cancel-button',
        //     // label: 'Unlock Me!',
        //     x_align: Clutter.ActorAlign.START,
        //     y_align: Clutter.ActorAlign.CENTER,
        //     child: new St.Icon({ icon_name: 'go-next-symbolic' }),
        // });
        // this.loginButton.child.y_fill = true;
        // this.loginButton.connect('clicked', () => this.cancel());
        // this._mainBox.add_child(this.loginButton);

        let capsLockPlaceholder = new St.Label();
        this.add_child(capsLockPlaceholder);

        this._capsLockWarningLabel = new CinnamonEntry.CapsLockWarning({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._capsLockWarningLabel);

        this._capsLockWarningLabel.bind_property('visible',
            capsLockPlaceholder, 'visible',
            GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.INVERT_BOOLEAN);

        this._message = new St.Label({
            opacity: 0,
            styleClass: 'login-dialog-message',
            y_expand: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.START,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._message.clutter_text.line_wrap = true;
        this._message.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.add_child(this._message);
    }

    _onDestroy() {
        this._userVerifier.destroy();
        this._userVerifier = null;
    }

    vfunc_key_press_event(keyPressEvent) {
        if (keyPressEvent.keyval == Clutter.KEY_Escape)
            this.cancel();
        return super.vfunc_key_press_event(keyPressEvent);
    }

    _activateNext(shouldSpin) {
        this.verificationStatus = AuthPromptStatus.VERIFICATION_IN_PROGRESS;
        this.updateSensitivity(false);

        // if (shouldSpin)
        //     this.startSpinning();

        if (this._queryingService)
            this._userVerifier.answerQuery(this._queryingService, this._entry.text);
        else
            this._preemptiveAnswer = this._entry.text;

        this.emit('next');
    }

    _updateEntry(secret) {
        if (secret && this._entry !== this._passwordEntry) {
            this._mainBox.replace_child(this._entry, this._passwordEntry);
            this._entry = this._passwordEntry;
        } else if (!secret && this._entry !== this._textEntry) {
            this._mainBox.replace_child(this._entry, this._textEntry);
            this._entry = this._textEntry;
        }
        this._capsLockWarningLabel.visible = secret;
    }

    _onAskQuestion(verifier, serviceName, question, secret) {
        if (this._queryingService)
            this.clear();

        this._queryingService = serviceName;
        if (this._preemptiveAnswer) {
            this._userVerifier.answerQuery(this._queryingService, this._preemptiveAnswer);
            this._preemptiveAnswer = null;
            return;
        }

        this._updateEntry(secret);

        // Hack: The question string comes directly from PAM, if it's "Password:"
        // we replace it with our own to allow localization, if it's something
        // else we remove the last colon and any trailing or leading spaces.
        if (question === 'Password:' || question === 'Password: ')
            this.setQuestion(_('Password'));
        else
            this.setQuestion(question.replace(/: *$/, '').trim());

        this.updateSensitivity(true);
        this.emit('prompted');
    }

    _onReset() {
        this.verificationStatus = AuthPromptStatus.NOT_VERIFYING;
        this.reset();
    }

    _fadeOutMessage() {
        if (this._message.opacity == 0)
            return;
        this._message.remove_all_transitions();
        this._message.ease({
            opacity: 0,
            duration: MESSAGE_FADE_OUT_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    updateSensitivity(sensitive) {
        if (this._entry.reactive === sensitive)
            return;

        this._entry.reactive = sensitive;

        if (sensitive) {
            this._entry.grab_key_focus();
        } else {
            this.grab_key_focus();

            if (this._entry === this._passwordEntry)
                this._entry.password_visible = false;
        }
    }

    clear() {
        this._entry.text = '';
        // this.stopSpinning();
    }

    setQuestion(question) {
        this._entry.hint_text = question;

        this._entry.show();
        this._entry.grab_key_focus();
    }

    setUser(user) {
        let oldChild = this._userWell.get_child();
        if (oldChild)
            oldChild.destroy();

        if (user) {
            let userWidget = new UserWidget.UserWidget(user, Clutter.Orientation.VERTICAL);
            this._userWell.set_child(userWidget);
        }

        if (!user)
            this._updateEntry(false);
    }

    reset() {
        let oldStatus = this.verificationStatus;
        this.verificationStatus = AuthPromptStatus.NOT_VERIFYING;
        this._preemptiveAnswer = null;

        if (this._userVerifier)
            this._userVerifier.cancel();

        this._queryingService = null;
        this.clear();
        this._message.opacity = 0;
        this.setUser(null);
        this._updateEntry(true);
        // this.stopSpinning();

        if (oldStatus == AuthPromptStatus.VERIFICATION_FAILED)
            this.emit('failed');
        else if (oldStatus === AuthPromptStatus.VERIFICATION_CANCELLED)
            this.emit('cancelled');

        let beginRequestType;

        if (oldStatus === AuthPromptStatus.VERIFICATION_CANCELLED)
                return;
        beginRequestType = BeginRequestType.PROVIDE_USERNAME;

        this.emit('reset', beginRequestType);
    }

    begin(params) {
        params = Params.parse(params, { userName: null,
                                        hold: null });

        this.updateSensitivity(false);

        let hold = params.hold;
        if (!hold)
            hold = new Batch.Hold();

        this._userVerifier.begin(params.userName, hold);
        this.verificationStatus = AuthPromptStatus.VERIFYING;
    }

    cancel() {
        this.emit('deactivate');
    }
});

var Clock = GObject.registerClass(
class UnlockDialogClock extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'unlock-dialog-clock',
            vertical: true,
        });

        this._time = new St.Label({
            style_class: 'unlock-dialog-clock-time',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._date = new St.Label({
            style_class: 'unlock-dialog-clock-date',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._hint = new St.Label({
            style_class: 'unlock-dialog-clock-hint',
            x_align: Clutter.ActorAlign.CENTER,
            // opacity: 0,
        });

        this.add_child(this._time);
        this.add_child(this._date);
        this.add_child(this._hint);

        this._wallClock = new CinnamonDesktop.WallClock();
        this._wallClock.connect('notify::clock', this._updateClock.bind(this));

        this._updateClock();
        this._updateHint();

        this.connect('destroy', this._onDestroy.bind(this));
    }

    _updateClock() {
        this._time.text = this._wallClock.clock;

        let dateFormatted = this._wallClock.get_clock_for_format(DATE_FORMAT_FULL).capitalize();

        // let date = new Date();
        /* Translators: This is a time format for a date in
           long format */
        // let dateFormat = Shell.util_translate_time_string(N_('%A %B %-d'));
        // this._date.text = date.toLocaleFormat(dateFormat);

        // this._time.text = '12:00';
        this._date.text = dateFormatted;
    }

    _updateHint() {
        // this._hint.text = this._seat.touch_mode
        //     ? _('Swipe up to unlock')
        //     : _('Click or press a key to unlock');
        this._hint.text = _('Click or press a key to unlock');
    }

    _onDestroy() {
        this._wallClock.run_dispose();

        // this._seat.disconnect(this._touchModeChangedId);
        // this._idleMonitor.remove_watch(this._idleWatchId);
        // this._monitorManager.disconnect(this._powerModeChangedId);
    }
});

var UnlockDialogLayout = GObject.registerClass(
class UnlockDialogLayout extends Clutter.LayoutManager {
    _init(stack) {
        super._init();

        this._stack = stack;
    }

    vfunc_get_preferred_width(container, forHeight) {
        return this._stack.get_preferred_width(forHeight);
    }

    vfunc_get_preferred_height(container, forWidth) {
        return this._stack.get_preferred_height(forWidth);
    }

    vfunc_allocate(container, box, flags) {
        let [width, height] = box.get_size();

        let tenthOfHeight = height / 10.0;
        let thirdOfHeight = height / 3.0;

        let [, , stackWidth, stackHeight] =
            this._stack.get_preferred_size();

        let columnWidth = stackWidth;

        let columnX1 = Math.floor((width - columnWidth) / 2.0);
        let actorBox = new Clutter.ActorBox();

        // Authentication Box
        let stackY = Math.min(
            thirdOfHeight,
            height - stackHeight);

        actorBox.x1 = columnX1;
        actorBox.y1 = stackY;
        actorBox.x2 = columnX1 + columnWidth;
        actorBox.y2 = stackY + stackHeight;

        this._stack.allocate(actorBox, flags);
    }
});

var UnlockDialog = GObject.registerClass({
    Signals: {
        'failed': {},
        'wake-up-screen': {},
        'deactivate': {},
    },
}, class UnlockDialog extends St.Widget {
    _init(parentActor) {
        super._init({
            accessible_role: Atk.Role.WINDOW,
            style_class: 'unlock-dialog',
            visible: false,
            reactive: true,
        });

        parentActor.add_child(this);

        this._gdmClient = new Gdm.Client();

        this.connect('scroll-event', (o, event) => {
            let direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.UP)
                this._showClock();
            else if (direction === Clutter.ScrollDirection.DOWN)
                this._showPrompt();
            return Clutter.EVENT_STOP;
        });

        this._activePage = null;

        // Background
        this._backgroundGroup = new Clutter.Actor();
        // this._backgroundGroup.set_background_color(new Clutter.Color(
        //     {red: 0, green: 0, blue: 0, alpha: 255}));
        this.add_child(this._backgroundGroup);

        this._bgManagers = [];

        this._updateBackgrounds();

        this._userManager = AccountsService.UserManager.get_default();
        this._userName = GLib.get_user_name();
        this._user = this._userManager.get_user(this._userName);

        this._stack = new Cinnamon.Stack();

        this._promptBox = new St.BoxLayout({ vertical: true });
        this._promptBox.set_pivot_point(0.5, 0.5);
        // this._promptBox.hide();
        this._stack.add_child(this._promptBox);

        this._clock = new Clock();
        this._clock.set_pivot_point(0.5, 0.5);
        this._stack.add_child(this._clock);
        this._showClock();

        // Main Box
        let mainBox = new St.Widget();
        mainBox.add_constraint(new Layout.MonitorConstraint({ primary: true }));
        mainBox.add_child(this._stack);
        mainBox.layout_manager = new UnlockDialogLayout(this._stack);
        this.add_child(mainBox);

        this._authPrompt = null;

        // Temp
        // this._unlockButton = new St.Button({
        //     style_class: 'button',
        //     label: 'Unlock Me!',
        // });
        // this._unlockButton.add_style_pseudo_class('destructive-action');
        // this._unlockButton.connect('clicked', () => {
        //     this.emit('deactivate');
        // });
        // this._promptBox.add_child(this._unlockButton);

        this.connect('destroy', this._onDestroy.bind(this));
    }

    vfunc_key_press_event(keyEvent) {
        global.log("Key press event_____________________________________");
        if (this._activePage === this._promptBox ||
            (this._promptBox && this._promptBox.visible))
            return Clutter.EVENT_PROPAGATE;

        const { keyval } = keyEvent;
        if (keyval === Clutter.KEY_Shift_L ||
            keyval === Clutter.KEY_Shift_R ||
            keyval === Clutter.KEY_Shift_Lock ||
            keyval === Clutter.KEY_Caps_Lock)
            return Clutter.EVENT_PROPAGATE;

        let unichar = keyEvent.unicode_value;

        this._showPrompt();

        // if (GLib.unichar_isgraph(unichar))
        //     this._authPrompt.addCharacter(unichar);

        return Clutter.EVENT_PROPAGATE;
    }

    _createBackground(monitorIndex) {
        let monitor = Main.layoutManager.monitors[monitorIndex];
        let widget = new St.Widget({
            style_class: 'screen-shield-background',
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });

        this._bgManagers.push(widget);

        this._backgroundGroup.add_child(widget);
    }

    _updateBackgrounds() {
        for (let i = 0; i < this._bgManagers.length; i++)
            this._bgManagers[i].destroy();

        this._bgManagers = [];
        this._backgroundGroup.destroy_all_children();

        for (let i = 0; i < Main.layoutManager.monitors.length; i++)
            this._createBackground(i);
    }

    _ensureAuthPrompt() {
        if (this._authPrompt)
            return;

        this._authPrompt = new AuthPrompt(this._gdmClient);
        this._authPrompt.connect('failed', this._fail.bind(this));
        this._authPrompt.connect('cancelled', this._fail.bind(this));
        this._authPrompt.connect('reset', this._onReset.bind(this));

        this._authPrompt.setUser(this._user);
        this._authPrompt.connect('deactivate', () => {
            this.emit('deactivate');
        });

        this._promptBox.add_child(this._authPrompt);

        this._authPrompt.reset();
        this._authPrompt.updateSensitivity(true);
    }

    _maybeDestroyAuthPrompt() {
        let focus = global.stage.key_focus;
        if (focus === null ||
            (this._authPrompt && this._authPrompt.contains(focus)))
            this.grab_key_focus();

        if (this._authPrompt) {
            this._authPrompt.destroy();
            this._authPrompt = null;
        }
    }

    _showClock() {
        if (this._activePage === this._clock)
            return;

        this._activePage = this._clock;
        // this._promptBox.hide();
        this._clock.show();

        this._promptBox.ease({
            opacity: 0,
            duration: CROSSFADE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._promptBox.hide();
                this._maybeDestroyAuthPrompt();
            },
        });

        this._clock.ease({
            opacity: 255,
            duration: CROSSFADE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // this._adjustment.ease(0, {
        //     duration: CROSSFADE_TIME,
        //     mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        //     onComplete: () => this._maybeDestroyAuthPrompt(),
        // });
    }

    _showPrompt() {
        global.log("Showing prompt");
        this._ensureAuthPrompt();

        if (this._activePage === this._promptBox) {
            global.log("returning true");
            return;
        }

        this._activePage = this._promptBox;
        // this._clock.hide();
        this._promptBox.show();

        this._clock.ease({
            opacity: 0,
            duration: CROSSFADE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._clock.hide(),
        });

        this._promptBox.ease({
            opacity: 255,
            duration: CROSSFADE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _fail() {
        this._showClock();
        this.emit('failed');
    }

    _onReset(authPrompt, beginRequest) {
        let userName;
        if (beginRequest == BeginRequestType.PROVIDE_USERNAME) {
            this._authPrompt.setUser(this._user);
            userName = this._userName;
        } else {
            userName = null;
        }

        this._authPrompt.begin({ userName });
    }

    _onDestroy() {

    }

    cancel() {
        this.hide();
    }

    open(timestamp) {
        this.show();

        if (this._isModal)
            return true;

        if (!Main.pushModal(this, timestamp))
            return false;

        this._isModal = true;

        // this._showPrompt();

        return true;
    }
});