const { Cinnamon, Clutter, Gio, GLib, GObject, Meta, St } = imports.gi;
const Signals = imports.signals;

// Time for initial animation going into Overview mode;
// this is defined here to make it available in imports.
var ANIMATION_TIME = 250;

const DND = imports.ui.dnd;
const LayoutManager = imports.ui.layout;
const Main = imports.ui.main;
// const MessageTray = imports.ui.messageTray;
const CoverviewControls = imports.ui.coverviewControls;
const Params = imports.misc.params;
// const SwipeTracker = imports.ui.swipeTracker;
const WindowManager = imports.ui.windowManager;
const WorkspaceThumbnail = imports.ui.workspaceThumbnail;

var DND_WINDOW_SWITCH_TIMEOUT = 750;

var OVERVIEW_ACTIVATION_TIMEOUT = 0.5;

var OverviewActor = GObject.registerClass(
class OverviewActor extends St.BoxLayout {
    _init() {
        super._init({
            name: 'overview',
            vertical: true,
        });

        this.add_constraint(new LayoutManager.MonitorConstraint({ primary: true }));

        this._controls = new CoverviewControls.ControlsManager();
        this.add_child(this._controls);
    }

    animateToOverview(state, callback) {
        global.log("animating to overview----------------------------");
        this._controls.animateToOverview(state, callback);
    }

    animateFromOverview(callback) {
        global.log("animating from overview actor--------------------------------");
        this._controls.animateFromOverview(callback);
    }

    get controls() {
        return this._controls;
    }
});

var Overview = class {
    constructor() {
        this._initCalled = false;
        this._visible = false;

        this._createOverview();
    }

    get animationInProgress() {
        return this._animationInProgress;
    }

    get visible() {
        return this._visible;
    }

    get visibleTarget() {
        return this._visibleTarget;
    }

    get closing() {
        return this._animationInProgress && !this._visibleTarget;
    }

    _createOverview() {
        if (this._overview)
            return;

        this._desktopFade = new St.Widget();
        Main.layoutManager.overviewGroup.add_child(this._desktopFade);

        this._activationTime = 0;

        this._visible = false;          // animating to overview, in overview, animating out
        this._shown = false;            // show() and not hide()
        this._modal = false;            // have a modal grab
        this._animationInProgress = false;
        this._visibleTarget = false;

        // During transitions, we raise this to the top to avoid having the overview
        // area be reactive; it causes too many issues such as double clicks on
        // Dash elements, or mouseover handlers in the workspaces.
        this._coverPane = new Clutter.Actor({
            opacity: 0,
            reactive: true,
        });
        Main.layoutManager.overviewGroup.add_child(this._coverPane);
        this._coverPane.connect('event', () => Clutter.EVENT_STOP);
        this._coverPane.hide();

        Main.layoutManager.overviewGroup.connect('scroll-event',
                                                 this._onScrollEvent.bind(this));

        global.display.connect('restacked', this._onRestacked.bind(this));

        this._windowSwitchTimeoutId = 0;
        this._windowSwitchTimestamp = 0;
        this._lastActiveWorkspaceIndex = -1;
        this._lastHoveredWindow = null;

        if (this._initCalled)
            this.init();
    }

    // The members we construct that are implemented in JS might
    // want to access the overview as Main.overview to connect
    // signal handlers and so forth. So we create them after
    // construction in this init() method.
    init() {
        this._initCalled = true;

        this._overview = new OverviewActor();
        this._overview._delegate = this;
        Main.layoutManager.overviewGroup.add_child(this._overview);

        Main.layoutManager.connect('monitors-changed', this._relayout.bind(this));
        this._relayout();
    }

    _resetWindowSwitchTimeout() {
        if (this._windowSwitchTimeoutId != 0) {
            GLib.source_remove(this._windowSwitchTimeoutId);
            this._windowSwitchTimeoutId = 0;
        }
    }

    _onScrollEvent(actor, event) {
        this.emit('scroll-event', event);
        return Clutter.EVENT_PROPAGATE;
    }

    _getDesktopClone() {
        let windows = global.get_window_actors().filter(
            w => w.meta_window.get_window_type() === Meta.WindowType.DESKTOP);
        if (windows.length == 0)
            return null;

        let window = windows[0];
        let clone = new Clutter.Clone({
            source: window,
            x: window.x,
            y: window.y
        });
        clone.source.connect('destroy', () => {
            clone.destroy();
        });
        return clone;
    }

    _relayout() {
        // To avoid updating the position and size of the workspaces
        // we just hide the overview. The positions will be updated
        // when it is next shown.
        this.hide();

        this._coverPane.set_position(0, 0);
        this._coverPane.set_size(global.screen_width, global.screen_height);
    }

    _onRestacked() {
        let stack = global.get_window_actors();
        let stackIndices = {};

        for (let i = 0; i < stack.length; i++) {
            // Use the stable sequence for an integer to use as a hash key
            stackIndices[stack[i].get_meta_window().get_stable_sequence()] = i;
        }

        this.emit('windows-restacked', stackIndices);
    }

    fadeInDesktop() {
        this._desktopFade.opacity = 0;
        this._desktopFade.show();
        this._desktopFade.ease({
            opacity: 255,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            duration: ANIMATION_TIME,
        });
    }

    fadeOutDesktop() {
        if (!this._desktopFade.get_n_children()) {
            let clone = this._getDesktopClone();
            if (!clone)
                return;

            this._desktopFade.add_child(clone);
        }

        this._desktopFade.opacity = 255;
        this._desktopFade.show();
        this._desktopFade.ease({
            opacity: 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            duration: ANIMATION_TIME,
        });
    }

    _syncGrab() {
        // We delay grab changes during animation so that when removing the
        // overview we don't have a problem with the release of a press/release
        // going to an application.
        if (this._animationInProgress)
            return true;

        if (this._shown) {
            let shouldBeModal = true;
            // let shouldBeModal = !this._inXdndDrag;
            if (shouldBeModal && !this._modal) {
                // let actionMode = Shell.ActionMode.OVERVIEW;
                if (Main.pushModal(this._overview)) {
                    this._modal = true;
                } else {
                    this.hide();
                    return false;
                }
            }
        } else {
            // eslint-disable-next-line no-lonely-if
            if (this._modal) {
                Main.popModal(this._overview);
                this._modal = false;
            }
        }
        return true;
    }

    // show:
    //
    // Animates the overview visible and grabs mouse and keyboard input
    show(state = CoverviewControls.ControlsState.WINDOW_PICKER) {
        if (state === CoverviewControls.ControlsState.HIDDEN)
            throw new Error('Invalid state, use hide() to hide');

        // if (this.isDummy)
        //     return;
        if (this._shown)
            return;
        this._shown = true;

        if (!this._syncGrab())
            return;

        Main.layoutManager.showOverview();
        this._animateVisible(state);
    }

    _animateVisible(state) {
        global.log("animating visible-----------------------------------");
        if (this._visible || this._animationInProgress)
            return;

        this._visible = true;
        this._animationInProgress = true;
        this._visibleTarget = true;
        this._activationTime = GLib.get_monotonic_time() / GLib.USEC_PER_SEC;

        Meta.disable_unredirect_for_display(global.display);

        this._overview.animateToOverview(state, () => this._showDone());

        Main.layoutManager.overviewGroup.set_child_above_sibling(
            this._coverPane, null);
        this._coverPane.show();
        this.emit('showing');
    }

    _showDone() {
        global.log("show done----------------------------");
        this._animationInProgress = false;
        this._desktopFade.hide();
        this._coverPane.hide();

        this.emit('shown');
        // Handle any calls to hide* while we were showing
        if (!this._shown)
            this._animateNotVisible();

        this._syncGrab();
    }

    // hide:
    //
    // Reverses the effect of show()
    hide() {
        // if (this.isDummy)
        //     return;

        global.log("hididng------------------------------");

        if (!this._shown)
            return;

        let event = Clutter.get_current_event();
        if (event) {
            let type = event.type();
            let button = type == Clutter.EventType.BUTTON_PRESS ||
                          type == Clutter.EventType.BUTTON_RELEASE;
            let ctrl = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) != 0;
            if (button && ctrl)
                return;
        }

        this._shown = false;

        this._animateNotVisible();
        this._syncGrab();
    }

    _animateNotVisible() {
        global.log("Animating the hide--------------------------------");
        if (!this._visible || this._animationInProgress)
            return;

        this._animationInProgress = true;
        this._visibleTarget = false;

        this._overview.animateFromOverview(() => this._hideDone());

        Main.layoutManager.overviewGroup.set_child_above_sibling(
            this._coverPane, null);
        this._coverPane.show();
        this.emit('hiding');
    }

    _hideDone() {
        global.log("Hiding done----------------------------");
        // Re-enable unredirection
        Meta.enable_unredirect_for_display(global.display);

        this._desktopFade.hide();
        this._coverPane.hide();

        this._visible = false;
        this._animationInProgress = false;

        // Handle any calls to show* while we were hiding
        if (this._shown) {
            this.emit('hidden');
            this._animateVisible(OverviewControls.ControlsState.WINDOW_PICKER);
        } else {
            Main.layoutManager.hideOverview();
            this.emit('hidden');
        }

        // Main.panel.style = null;

        this._syncGrab();
    }

    toggle() {
        // if (this.isDummy)
        //     return;

        if (this._visible)
            this.hide();
        else
            this.show();
    }
};
Signals.addSignalMethods(Overview.prototype);
