const Applet = imports.ui.applet;
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Main = imports.ui.main;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const MessageList = imports.ui.messageList;
const MessageTray = imports.ui.messageTray;
const Urgency = imports.ui.messageTray.Urgency;
const NotificationDestroyedReason = imports.ui.messageTray.NotificationDestroyedReason;
const Settings = imports.ui.settings;
const Gettext = imports.gettext.domain("cinnamon-applets");
const Util = imports.misc.util;

const PANEL_EDIT_MODE_KEY = "panel-edit-mode";

const Placeholder = GObject.registerClass(
class Placeholder extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'message-list-placeholder',
            vertical: true,
        });

        this._icon = new St.Icon({ icon_name: 'empty-notif-symbolic' });
        this.add_child(this._icon);

        this._label = new St.Label({ text: _('No Notifications') });
        this.add_child(this._label);
    }
});

const NotificationSection = GObject.registerClass(
class NotificationSection extends MessageList.MessageListSection {
    _init() {
        super._init();

        this._nUrgent = 0;

        Main.messageTray.connect('source-added', this._sourceAdded.bind(this));
        Main.messageTray.getSources().forEach(source => {
            this._sourceAdded(Main.messageTray, source);
        });
    }

    // get allowed() {
    //     return Main.sessionMode.hasNotifications &&
    //            !Main.sessionMode.isGreeter;
    // }

    _sourceAdded(tray, source) {
        source.connectObject('notification-added',
            this._onNotificationAdded.bind(this), this);
    }

    _onNotificationAdded(source, notification) {
        global.log("_onNotificationAdded");
        let message = new MessageTray.NotificationMessage(notification);

        let isUrgent = notification.urgency === MessageTray.Urgency.CRITICAL;

        notification.connectObject(
            'destroy', () => {
                if (isUrgent)
                    this._nUrgent--;
            }, this);
            // 'notify::datetime', () => {
            //     // The datetime property changes whenever the notification is updated
            //     this.moveMessage(message, isUrgent ? 0 : this._nUrgent, this.mapped);
            // }, this);

        if (isUrgent) {
            // Keep track of urgent notifications to keep them on top
            this._nUrgent++;
        } else if (this.mapped) {
            // Only acknowledge non-urgent notifications in case it
            // has important actions that are inaccessible when not
            // shown as banner
            notification.acknowledged = true;
        }

        let index = isUrgent ? 0 : this._nUrgent;
        this.addMessageAtIndex(message, index, this.mapped);
        global.log("Added message at index");
    }

    vfunc_map() {
        this._messages.forEach(message => {
            if (message.notification.urgency !== MessageTray.Urgency.CRITICAL)
                message.notification.acknowledged = true;
        });
        super.vfunc_map();
    }
});

const NotificationMessageList = GObject.registerClass(
class NotificationMessageList extends St.Widget {
    _init() {
        super._init({
            style_class: 'message-list',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });

        this._placeholder = new Placeholder();
        this.add_child(this._placeholder);

        let box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        this.add_child(box);

        this._scrollView = new St.ScrollView ({
            style_class: 'vfade',
            overlay_scrollbars: true,
            x_fill: true,
            y_fill: true,
        });
        box.add_child(this._scrollView);
        this._scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.NEVER);

        let hbox = new St.BoxLayout({ style_class: 'message-list-controls' });
        box.add_child(hbox);

        this._clearButton = new St.Button({
            style_class: 'button',
            label: _('Clear'),
            can_focus: true,
            // x_expand: true,
            x_align: St.Align.END,
            // y_align: St.Align.END,
        });
        this._clearButton.connect('clicked', () => {
            this._sectionList.get_children().forEach(s => s.clear());
        });
        hbox.add_child(this._clearButton);

        this._placeholder.bind_property('visible',
            this._clearButton, 'visible',
            GObject.BindingFlags.INVERT_BOOLEAN);

        this._sectionList = new St.BoxLayout({
            style_class: 'message-list-sections',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });

        this._sectionList.connectObject(
            'actor-added', this._sync.bind(this),
            'actor-removed', this._sync.bind(this),
            this);
        this._scrollView.child = this._sectionList;

        this._notificationSection = new NotificationSection();
        this._addSection(this._notificationSection);
    }

    _addSection(section) {
        section.connectObject(
            'notify::visible', this._sync.bind(this),
            'notify::empty', this._sync.bind(this),
            'notify::can-clear', this._sync.bind(this),
            'destroy', () => this._sectionList.remove_child(section),
            'message-focused', (_s, messageActor) => {
               global.log("message focused");
            }, this);
            // 'message-focused', (_s, messageActor) => {
            //     ensureActorVisibleInScrollView(this._scrollView, messageActor);
            // }, this);
        this._sectionList.add_child(section);
        // section.connect('message-focused',)

        // this._sectionList.add_child(section);
    }

    _sync() {
        let sections = this._sectionList.get_children();
        let visible = sections.some(s => s.allowed);
        global.log("Is visible");
        this.visible = visible;
        if (!visible)
            return;

        let empty = sections.every(s => s.empty || !s.visible);
        this._placeholder.visible = empty;

        let canClear = sections.some(s => s.canClear && s.visible);
        this._clearButton.reactive = canClear;
    }
});

class CinnamonNotificationsApplet extends Applet.TextIconApplet {
    constructor(metadata, orientation, panel_height, instanceId) {
        super(orientation, panel_height, instanceId);

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);

        // Settings
        this.settings = new Settings.AppletSettings(this, metadata.uuid, instanceId);
        this.settings.bind("ignoreTransientNotifications", "ignoreTransientNotifications");
        this.settings.bind("showEmptyTray", "showEmptyTray", this._show_hide_tray);
        this.settings.bind("keyOpen", "keyOpen", this._setKeybinding);
        this.settings.bind("keyClear", "keyClear", this._setKeybinding);
        this.settings.bind("showNotificationCount", "showNotificationCount", this.update_list);
        this._setKeybinding();

        // Layout
        this._orientation = orientation;
        this.menuManager = new PopupMenu.PopupMenuManager(this);

        // Lists
        this.notifications = [];    // The list of notifications, in order from oldest to newest.

        // Events
        // Main.messageTray.connect('notify-applet-update', Lang.bind(this, this._notification_added));
        global.settings.connect('changed::' + PANEL_EDIT_MODE_KEY, Lang.bind(this, this._on_panel_edit_mode_changed));

        // States
        this._blinking = false;
        this._blink_toggle = false;
    }

    _setKeybinding() {
        Main.keybindingManager.addHotKey("notification-open-" + this.instance_id, this.keyOpen, Lang.bind(this, this._openMenu));
        Main.keybindingManager.addHotKey("notification-clear-" + this.instance_id, this.keyClear, Lang.bind(this, this._clear_all));
    }

    on_applet_removed_from_panel () {
        Main.keybindingManager.removeHotKey("notification-open-" + this.instance_id);
        Main.keybindingManager.removeHotKey("notification-clear-" + this.instance_id);
    }

    _openMenu() {
        // this._update_timestamp();
        this.menu.toggle();
    }

    _display() {
        // Always start the applet empty, void of any notifications.
        this.set_applet_icon_symbolic_name("empty-notif");
        this.set_applet_tooltip(_("Notifications"));

        // Setup the notification container.
        this._mainContainer = new NotificationMessageList();
        // this._maincontainer = new St.BoxLayout({name: 'traycontainer', vertical: true});
        // this._notificationbin = new St.BoxLayout({vertical:true});
        // this.button_label_box = new St.BoxLayout();

        // Setup the tray icon.
        // this.menu_label = new PopupMenu.PopupMenuItem(stringify(this.notifications.length));
        // this.menu_label.actor.reactive = false;
        // this.menu_label.actor.can_focus = false;
        // this.menu_label.label.add_style_class_name('popup-subtitle-menu-item');

        // this.clear_separator = new PopupMenu.PopupSeparatorMenuItem();

        // this.clear_action = new PopupMenu.PopupMenuItem(_("Clear notifications"));
        // this.clear_action.connect('activate', Lang.bind(this, this._clear_all));
        // this.clear_action.actor.hide();

        if (this._orientation == St.Side.BOTTOM) {
            // this.menu.addMenuItem(this.menu_label);
            this.menu.addActor(this._mainContainer);
            // this.menu.addMenuItem(this.clear_separator);
            // this.menu.addMenuItem(this.clear_action);
        } else {
            // this.menu.addMenuItem(this.clear_action);
            // this.menu.addMenuItem(this.clear_separator);
            // this.menu.addMenuItem(this.menu_label);
            this.menu.addActor(this._mainContainer);
        }

        // this.scrollview = new St.ScrollView({ x_fill: true, y_fill: true, y_align: St.Align.START, style_class: "vfade"});
        // this._mainContainer.add_child(this.scrollview);
        // this.scrollview.add_actor(this._notificationbin);
        // this.scrollview.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        // this.scrollview.set_clip_to_allocation(true);

        // let vscroll = this.scrollview.get_vscroll_bar();
        // vscroll.connect('scroll-start', Lang.bind(this, function() {
        //     this.menu.passEvents = true;
        // }));
        // vscroll.connect('scroll-stop', Lang.bind(this, function() {
        //     this.menu.passEvents = false;
        // }));

        // Alternative tray icons.
        this._crit_icon = new St.Icon({icon_name: 'critical-notif', icon_type: St.IconType.SYMBOLIC, reactive: true, track_hover: true, style_class: 'system-status-icon' });
        this._alt_crit_icon = new St.Icon({icon_name: 'alt-critical-notif', icon_type: St.IconType.SYMBOLIC, reactive: true, track_hover: true, style_class: 'system-status-icon' });

        this._on_panel_edit_mode_changed();

        // this.menu.addSettingsAction(_("Notification Settings"), 'notifications');
    }

    // _notification_added (mtray, notification) { // Notification event handler.
    //     // Ignore transient notifications?
    //     if (this.ignoreTransientNotifications && notification.isTransient) {
    //         notification.destroy();
    //         return;
    //     }

    //     notification.actor.unparent();
    //     let existing_index = this.notifications.indexOf(notification);
    //     if (existing_index != -1) { // This notification is already listed.
    //         if (notification._destroyed) {
    //             this.notifications.splice(existing_index, 1);
    //         } else {
    //             notification._inNotificationBin = true;
    //             // global.reparentActor(notification.actor, this._notificationbin);
    //             // notification._timeLabel.show();
    //         }
    //         this.update_list();
    //         return;
    //     } else if (notification._destroyed) {
    //         return;
    //     }
    //     // Add notification to list.
    //     notification._inNotificationBin = true;
    //     this.notifications.push(notification);
    //     // Steal the notification panel.
    //     // this._notificationbin.add(notification.actor);
    //     // notification.actor._parent_container = this._notificationbin;
    //     notification.actor.add_style_class_name('notification-applet-padding');
    //     // Register for destruction.
    //     // notification.connect('scrolling-changed', (notif, scrolling) => { this.menu.passEvents = scrolling });
    //     notification.connect('destroy', () => {
    //         let i = this.notifications.indexOf(notification);
    //         if (i != -1)
    //             this.notifications.splice(i, 1);
    //         this.update_list();
    //     });
    //     // notification._timeLabel.show();

    //     this.update_list();
    // }

    update_list () {
        try {
            let count = this.notifications.length;
            if (count > 0) {    // There are notifications.
                this.actor.show();
                // this.clear_action.actor.show();
                this.set_applet_label(count.toString());
                // Find max urgency and derive list icon.
                let max_urgency = -1;
                for (let i = 0; i < count; i++) {
                    let cur_urgency = this.notifications[i].urgency;
                    if (cur_urgency > max_urgency)
                        max_urgency = cur_urgency;
                }
                switch (max_urgency) {
                    case Urgency.LOW:
                        this._blinking = false;
                        this.set_applet_icon_symbolic_name("low-notif");
                        break;
                    case Urgency.NORMAL:
                    case Urgency.HIGH:
                        this._blinking = false;
                        this.set_applet_icon_symbolic_name("normal-notif");
                        break;
                    case Urgency.CRITICAL:
                        if (!this._blinking) {
                            this._blinking = true;
                            this.critical_blink();
                        }
                        break;
                }
            } else {    // There are no notifications.
                this._blinking = false;
                this.set_applet_label('');
                this.set_applet_icon_symbolic_name("empty-notif");
                // this.clear_action.actor.hide();
                if (!this.showEmptyTray) {
                    this.actor.hide();
                }
            }

            if (!this.showNotificationCount) {  // Don't show notification count
                this.set_applet_label('');
                // this.clear_action.actor.hide();
            }
            // this.menu_label.label.set_text(stringify(count));
            // this._notificationbin.queue_relayout();
        }
        catch (e) {
            global.logError(e);
        }
    }

    _clear_all() {
        let count = this.notifications.length;
        if (count > 0) {
            for (let i = count-1; i >=0; i--) {
                // this._notificationbin.remove_actor(this.notifications[i].actor);
                this.notifications[i].destroy(NotificationDestroyedReason.DISMISSED);
            }
        }
        this.notifications = [];
        this.update_list();
    }

    _show_hide_tray() { // Show or hide the notification tray.
        if(!global.settings.get_boolean(PANEL_EDIT_MODE_KEY)) {
            if (this.notifications.length || this.showEmptyTray) {
                this.actor.show();
            } else {
                this.actor.hide();
            }
        }
    }

    _on_panel_edit_mode_changed () {
        if (global.settings.get_boolean(PANEL_EDIT_MODE_KEY)) {
            this.actor.show();
        } else {
            this.update_list();
        }
    }

    on_applet_added_to_panel() {
        this.on_orientation_changed(this._orientation);
    }

    on_orientation_changed (orientation) {
        this._orientation = orientation;

        if (this.menu) {
            this.menu.destroy();
        }
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this._display();
    }

    on_applet_clicked(event) {
        this._openMenu();
    }

    on_btn_open_system_settings_clicked() {
        Util.spawnCommandLine("cinnamon-settings notifications");
    }

    _update_timestamp() {
        let len = this.notifications.length;
        if (len > 0) {
            for (let i = 0; i < len; i++) {
                let notification = this.notifications[i];
                let orig_time = notification._timestamp;
                // notification._timeLabel.clutter_text.set_markup(timeify(orig_time));
            }
        }
    }

    critical_blink () {
        if (!this._blinking)
            return;
        if (this._blink_toggle) {
            this._applet_icon_box.child = this._crit_icon;
        } else {
            this._applet_icon_box.child = this._alt_crit_icon;
        }
        this._blink_toggle = !this._blink_toggle;
        Mainloop.timeout_add_seconds(1, Lang.bind(this, this.critical_blink));
    }
}

function main(metadata, orientation, panel_height, instanceId) {
    return new CinnamonNotificationsApplet(metadata, orientation, panel_height, instanceId);
}

function stringify(count) {
    if (count === 0) {
        return _("No notifications");
    } else {
        return ngettext("%d notification", "%d notifications", count).format(count);
    }
}

function timeify(orig_time) {
    let settings = new Gio.Settings({schema_id: 'org.cinnamon.desktop.interface'});
    let use_24h = settings.get_boolean('clock-use-24h');
    let now = new Date();
    let diff = Math.floor((now.getTime() - orig_time.getTime()) / 1000); // get diff in seconds
    let str;
    if (use_24h) {
        str = orig_time.toLocaleFormat('%x, %T');
    } else {
        str = orig_time.toLocaleFormat('%x, %r');
    }
    switch (true) {
        case (diff <= 15): {
            str += " (" + _("just now") + ")";
            break;
        } case (diff > 15 && diff <= 59): {
            str += " (" + ngettext("%d second ago", "%d seconds ago", diff).format(diff) + ")";
            break;
        } case (diff > 59 && diff <= 3540): {
            let diff_minutes = Math.floor(diff / 60);
            str += " (" + ngettext("%d minute ago", "%d minutes ago", diff_minutes).format(diff_minutes) + ")";
            break;
        }
    }
    return str;
}
