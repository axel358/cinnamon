const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Graphene = imports.gi.Graphene;
const St = imports.gi.St;
const Signals = imports.signals;

const CinnamonDBus = imports.ui.cinnamonDBus;
const GnomeSession = imports.misc.gnomeSession;
const Main = imports.ui.main;
const UnlockDialog = imports.ui.unlockDialog;

const SCREENSAVER_SCHEMA = 'org.cinnamon.desktop.screensaver';
const LOCK_ENABLED_KEY = 'lock-enabled';

var ScreenShield = class {
    constructor() {
        this.actor = Main.layoutManager.screenShieldGroup;

        this._lockScreenGroup = new St.Widget({
            x_expand: true,
            y_expand: true,
            reactive: true,
            can_focus: true,
            name: 'lockScreenGroup',
            visible: false,
        });

        this._lockDialogGroup = new St.Widget({
            x_expand: true,
            y_expand: true,
            reactive: true,
            can_focus: true,
            pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
            name: 'lockDialogGroup',
        });

        this.actor.add_actor(this._lockScreenGroup);
        this.actor.add_actor(this._lockDialogGroup);

        this._presence = new GnomeSession.Presence((proxy, error) => {
            if (error) {
                logError(error, 'Error while reading gnome-session presence');
                return;
            }

            this._onStatusChanged(proxy.status);
        });
        this._presence.connectSignal('StatusChanged', (proxy, senderName, [status]) => {
            this._onStatusChanged(status);
        });

        this._screenSaverDBus = new CinnamonDBus.ScreenSaverDBus(this);

        this._settings = new Gio.Settings({ schema_id: SCREENSAVER_SCHEMA });

        this._isModal = false;
        this._isActive = false;
        this._isLocked = false;
        this._activationTime = 0;
    }

    _becomeModal() {
        if (this._isModal)
            return true;

        this._isModal = Main.pushModal(Main.uiGroup);

        return this._isModal;
    }

    _onStatusChanged(status) {
        if (status != GnomeSession.PresenceStatus.IDLE)
            return;

        if (!this._becomeModal()) {
            // We could not become modal, so we can't activate the
            // screenshield. The user is probably very upset at this
            // point, but any application using global grabs is broken
            // Just tell them to stop using this app
            //
            // XXX: another option is to kick the user into the gdm login
            // screen, where we're not affected by grabs
            // Main.notifyError(_("Unable to lock"),
            //                  _("Lock was blocked by an application"));
            global.log("Unable to lock");
            return;
        }

        if (this._activationTime == 0)
            this._activationTime = GLib.get_monotonic_time();

        let shouldLock = this._settings.get_boolean(LOCK_ENABLED_KEY) && !this._isLocked;
    }

    _ensureUnlockDialog(allowCancel) {
        if (!this._dialog) {
            // let constructor = Main.sessionMode.unlockDialog;
            // if (!constructor) {
            //     // This session mode has no locking capabilities
            //     this.deactivate(true);
            //     return false;
            // }

            this._dialog = new UnlockDialog.UnlockDialog(this._lockDialogGroup);
            this._dialog.connect('deactivate', () => {
                this.deactivate(true);
            })

            let time = global.get_current_time();
            if (!this._dialog.open(time)) {
                // This is kind of an impossible error: we're already modal
                // by the time we reach this...
                log('Could not open login dialog: failed to acquire grab');
                this.deactivate(true);
                return false;
            }

            // this._dialog.connect('failed', this._onUnlockFailed.bind(this));
            // this._wakeUpScreenId = this._dialog.connect(
            //     'wake-up-screen', this._wakeUpScreen.bind(this));
        }

        // this._dialog.allowCancel = allowCancel;
        // this._dialog.grab_key_focus();
        return true;
    }

    get active() {
        return this._isActive;
    }

    get activationTime() {
        return this._activationTime;
    }

    deactivate(animate) {
        if (this._dialog)
            this._continueDeactivate(animate);
        // if (this._dialog)
        //     this._dialog.finish(() => this._continueDeactivate(animate));
        // else
        //     this._continueDeactivate(animate);
    }

    _continueDeactivate(animate) {
        // this._hideLockScreen(animate);

        if (this._isModal) {
            Main.popModal(Main.uiGroup);
            this._isModal = false;
        }

        this._completeDeactivate();
    }

    _completeDeactivate() {
        if (this._dialog) {
            this._dialog.destroy();
            this._dialog = null;
        }

        this.actor.hide();

        Main.panelManager.enablePanels();

        this._activationTime = 0;
    }

    activate(animate) {
        if (this._activationTime == 0)
            this._activationTime = GLib.get_monotonic_time();

        if (!this._ensureUnlockDialog(true))
            return;

        Main.panelManager.disablePanels();

        this.actor.show();

        // if (Main.sessionMode.currentMode !== 'unlock-dialog') {
        //     this._isGreeter = Main.sessionMode.isGreeter;
        //     if (!this._isGreeter)
        //         Main.sessionMode.pushMode('unlock-dialog');
        // }

        // this._resetLockScreen({
        //     animateLockScreen: animate,
        //     fadeToBlack: true,
        // });
        // // On wayland, a crash brings down the entire session, so we don't
        // // need to defend against being restarted unlocked
        // if (!Meta.is_wayland_compositor())
        //     global.set_runtime_state(LOCKED_STATE_STR, GLib.Variant.new('b', true));

        // // We used to set isActive and emit active-changed here,
        // // but now we do that from lockScreenShown, which means
        // // there is a 0.3 seconds window during which the lock
        // // screen is effectively visible and the screen is locked, but
        // // the DBus interface reports the screensaver is off.
        // // This is because when we emit ActiveChanged(true),
        // // gnome-settings-daemon blanks the screen, and we don't want
        // // blank during the animation.
        // // This is not a problem for the idle fade case, because we
        // // activate without animation in that case.
    }

    lock(animate) {
        global.log("Locking the lock screen ___________________________________________");
        // if (this._lockSettings.get_boolean(DISABLE_LOCK_KEY)) {
        //     log('Screen lock is locked down, not locking'); // lock, lock - who's there?
        //     return;
        // }

        // // Warn the user if we can't become modal
        // if (!this._becomeModal()) {
        //     Main.notifyError(_("Unable to lock"),
        //                      _("Lock was blocked by an application"));
        //     return;
        // }

        // // Clear the clipboard - otherwise, its contents may be leaked
        // // to unauthorized parties by pasting into the unlock dialog's
        // // password entry and unmasking the entry
        // St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, '');
        // St.Clipboard.get_default().set_text(St.ClipboardType.PRIMARY, '');

        // let userManager = AccountsService.UserManager.get_default();
        // let user = userManager.get_user(GLib.get_user_name());

        this.activate(animate);

        // const lock = this._isGreeter
        //     ? true
        //     : user.password_mode !== AccountsService.UserPasswordMode.NONE;
        // this._setLocked(lock);
    }
};
Signals.addSignalMethods(ScreenShield.prototype);
