// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;

const Config = imports.misc.config;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const Params = imports.misc.params;

// don't automatically clear these apps' notifications on window focus
// lowercase only
const AUTOCLEAR_BLACKLIST = ['chromium', 'firefox', 'google chrome'];

// Should really be defined in Gio.js
const BusIface =
    '<node> \
        <interface name="org.freedesktop.DBus"> \
            <method name="GetConnectionUnixProcessID"> \
                <arg type="s" direction="in" /> \
                <arg type="u" direction="out" /> \
            </method> \
        </interface> \
    </node>';

var BusProxy = Gio.DBusProxy.makeProxyWrapper(BusIface);
function Bus() {
    return new BusProxy(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus');
}

const NotificationDaemonIface =
    '<node> \
        <interface name="org.freedesktop.Notifications"> \
            <method name="Notify"> \
                <arg type="s" direction="in"/> \
                <arg type="u" direction="in"/> \
                <arg type="s" direction="in"/> \
                <arg type="s" direction="in"/> \
                <arg type="s" direction="in"/> \
                <arg type="as" direction="in"/> \
                <arg type="a{sv}" direction="in"/> \
                <arg type="i" direction="in"/> \
                <arg type="u" direction="out"/> \
            </method> \
            <method name="CloseNotification"> \
                <arg type="u" direction="in"/> \
            </method> \
            <method name="GetCapabilities"> \
                <arg type="as" direction="out"/> \
            </method> \
            <method name="GetServerInformation"> \
                <arg type="s" direction="out"/> \
                <arg type="s" direction="out"/> \
                <arg type="s" direction="out"/> \
                <arg type="s" direction="out"/> \
            </method> \
            <signal name="NotificationClosed"> \
                <arg type="u"/> \
                <arg type="u"/> \
            </signal> \
            <signal name="ActionInvoked"> \
                <arg type="u"/> \
                <arg type="s"/> \
            </signal> \
        </interface> \
    </node>';

const NotificationClosedReason = {
    EXPIRED: 1,
    DISMISSED: 2,
    APP_CLOSED: 3,
    UNDEFINED: 4
};

const Urgency = {
    LOW: 0,
    NORMAL: 1,
    CRITICAL: 2
};

var NotificationDaemon = class NotificationDaemon {
    constructor() {
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(NotificationDaemonIface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/freedesktop/Notifications');

        // this._sources = [];
        this._senderToPid = {};
        // this._notifications = {};
        this._sourcesForApp = new Map();
        this._sourceForPidAndName = new Map();
        this._notifications = new Map();

        // this._expireNotifications = []; // List of expiring notifications in order from first to last to expire.
        // this._busProxy = new Bus();

        this._nextNotificationId = 1;

        // this._expireTimer = 0;

// Settings
        // this.settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.notifications" });
        // function setting(self, source, type, camelCase, dashed) {
        //     function updater() { self[camelCase] = source["get_"+type](dashed); }
        //     source.connect('changed::'+dashed, updater);
        //     updater();
        // }
        // setting(this, this.settings, "boolean", "removeOld", "remove-old");
        // setting(this, this.settings, "int", "timeout", "timeout");

        // Cinnamon.WindowTracker.get_default().connect('notify::focus-app',
        //     this._onFocusAppChanged.bind(this));
        // Main.overview.connect('hidden', this._onFocusAppChanged.bind(this));
    }

    _imageForNotificationData(hints) {
        if (hints['image-data']) {
            let [width, height, rowStride, hasAlpha,
                 bitsPerSample, nChannels, data] = hints['image-data'];
            return Cinnamon.util_create_pixbuf_from_data(data, GdkPixbuf.Colorspace.RGB, hasAlpha,
                                                      bitsPerSample, width, height, rowStride);
        } else if (hints['image-path']) {
            return this._iconForNotificationData(hints['image-path']);
        }
        return null;
    }

   // Create an icon for a notification from icon string/path.
    _iconForNotificationData(icon) {
        if (icon) {
            if (icon.startsWith('file://'))
                return new Gio.FileIcon({ file: Gio.File.new_for_uri(icon) });
            else if (icon.startsWith('/'))
                return new Gio.FileIcon({ file: Gio.File.new_for_path(icon) });
            else
                return new Gio.ThemedIcon({ name: icon });
        }

        return new Gio.ThemedIcon({ name: 'dialog-information-symbolic' });
    }

    _getApp(pid, appId, appName) {
        const appSys = Cinnamon.AppSystem.get_default();
        let app;

        app = Cinnamon.WindowTracker.get_default().get_app_from_pid(pid);
        if (!app && appId)
            app = appSys.lookup_app(`${appId}.desktop`);

        if (!app)
            app = appSys.lookup_app(`${appName}.desktop`);

        return app;
    }

    // Returns the source associated with an app.
    //
    // If no existing source is found a new one is created.
    _getSourceForApp(sender, app) {
        let source = this._sourcesForApp.get(app);

        if (source)
            return source;

        source = new NotificationSource(sender, app);

        if (app) {
            this._sourcesForApp.set(app, source);
            source.connect('destroy', () => {
                this._sourcesForApp.delete(app);
            });
        }

        Main.messageTray.add(source);
        return source;
    }

    // Returns the source associated with a pid and the app name.
    //
    // If no existing source is found, a new one is created.
    _getSourceForPidAndName(sender, pid, appName) {
        const key = `${pid}${appName}`;
        let source = this._sourceForPidAndName.get(key);

        if (source)
            return source;

        source = new NotificationSource(sender, null);

        // Only check whether we have a PID since it's enough to identify
        // uniquely an app and "" is a valid app name.
        if (pid) {
            this._sourceForPidAndName.set(key, source);
            source.connect('destroy', () => {
                this._sourceForPidAndName.delete(key);
            });
        }

        if (Main.messageTray)
            Main.messageTray.add(source);

        return source;
    }

    // _startExpire() {
    //      if (this.removeOld && this._expireNotifications.length && !this._expireTimer) {
    //         this._expireTimer = GLib.timeout_add_seconds(
    //             GLib.PRIORITY_DEFAULT,
    //             Math.max((this._expireNotifications[0].expires-Date.now())/1000, 1),
    //             this._expireNotification.bind(this));
    //     }
    // }
    // _stopExpire() {
    //      if (this._expireTimer == 0) {
    //         return;
    //     }
    //      GLib.source_remove(this._expireTimer);
    //      this._expireTimer = 0;
    // }
    // _restartExpire() {
    //      this._stopExpire();
    //      this._startExpire();
    // }
    // _expireNotification() {
    //     let ndata = this._expireNotifications[0];

    //     if (ndata) {
    //         ndata.notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
    //     }

    //     this._expireTimer = 0;
    //     return false;
    // }

    // Sends a notification to the notification daemon. Returns the id allocated to the notification.
    NotifyAsync(params, invocation) {
        let [appName, replacesId, appIcon, summary, body, actions, hints, timeout_] = params;
        let id;

        for (let hint in hints) {
            // unpack the variants
            hints[hint] = hints[hint].deep_unpack();
        }

        hints = {urgency: Urgency.NORMAL, ...hints};

        // Be compatible with the various hints for image data and image path
        // 'image-data' and 'image-path' are the latest name of these hints, introduced in 1.2

        if (!hints['image-path'] && hints['image_path'])
            hints['image-path'] = hints['image_path']; // version 1.1 of the spec

        if (!hints['image-data']) { // not version 1.2 of the spec?
            if (hints['image_data'])
                hints['image-data'] = hints['image_data']; // version 1.1 of the spec
            else if (hints['icon_data'] && !hints['image-path'])
                // early versions of the spec; 'icon_data' should only be used if 'image-path' is not available
                hints['image-data'] = hints['icon_data'];
        }

        // hints['suppress-sound'] = hints.maybeGet('suppress-sound') == true;

        let source, notification;
        if (replacesId !== 0 && this._notifications.has(replacesId)) {
            notification = this._notifications.get(replacesId);
            source = notification.source;
            id = replacesId;
        } else {
            const sender = hints['x-shell-sender'];
            const pid = hints['x-shell-sender-pid'];
            const appId = hints['desktop-entry'];
            const app = this._getApp(pid, appId, appName);

            id = this._nextNotificationId++;
            source = app
                ? this._getSourceForApp(sender, app)
                : this._getSourceForPidAndName(sender, pid, appName);

            notification = new MessageTray.Notification({ source });
            this._notifications.set(id, notification);
            notification.connect('destroy', (n, reason) => {
                this._notifications.delete(id);
                let notificationClosedReason;
                switch (reason) {
                    case MessageTray.NotificationDestroyedReason.EXPIRED:
                        notificationClosedReason = NotificationClosedReason.EXPIRED;
                        break;
                    case MessageTray.NotificationDestroyedReason.DISMISSED:
                        notificationClosedReason = NotificationClosedReason.DISMISSED;
                        break;
                    case MessageTray.NotificationDestroyedReason.SOURCE_CLOSED:
                        notificationClosedReason = NotificationClosedReason.APP_CLOSED;
                        break;
                }
                this._emitNotificationClosed(id, notificationClosedReason);
            });
        }

        const gicon = this._imageForNotificationData(hints);

        // notification.update(summary, body, {
        //     gicon,
        //     bodyMarkup: true,
        //     silent: hints['suppress-sound']
        // });

        notification.set({
            title: summary,
            body,
            gicon,
            useBodyMarkup: true,
            sound: null,
            acknowledged: false,
        });

        // notification.clearButtons();
        notification.clearActions();

        let hasDefaultAction = false;

        if (actions.length) {
            // notification.setUseActionIcons(hints.maybeGet('action-icons') == true);
            for (let i = 0; i < actions.length - 1; i += 2) {
                let [actionId, label] = [actions[i], actions[i + 1]];
                if (actionId === 'default') {
                    hasDefaultAction = true;
                } else {
                    notification.addAction(label, () => {
                        // this._emitActivationToken(source, id);
                        this._emitActionInvoked(id, actionId);
                    });
                }
                // if (actions[i] == 'default')
                //     notification.connect('action-invoked', () => {
                //         this._emitActionInvoked(id, "default");
                //     });
                // else
                //     notification.addButton(actions[i], actions[i + 1]);
            }
        }

        if (hasDefaultAction) {
            notification.connect('activated', () => {
                // this._emitActivationToken(source, id);
                this._emitActionInvoked(id, 'default');
            });
        } else {
            notification.connect('activated', () => {
                source.open();
            });
        }

        switch (hints.urgency) {
            case Urgency.LOW:
                notification.urgency = MessageTray.Urgency.LOW;
                break;
            case Urgency.NORMAL:
                notification.urgency = MessageTray.Urgency.NORMAL;
                break;
            case Urgency.CRITICAL:
                notification.urgency = MessageTray.Urgency.CRITICAL;
                break;
        }
        // notification.setResident(hints.maybeGet('resident') == true);
        notification.resident = !!hints.resident;
        // 'transient' is a reserved keyword in JS, so we have to retrieve the value
        // of the 'transient' hint with hints['transient'] rather than hints.transient
        // notification.setTransient(hints.maybeGet('transient') == true);
        notification.isTransient = !!hints['transient'];

        let privacyScope = hints['x-gnome-privacy-scope'] || 'user';
        notification.privacyScope = privacyScope === 'system'
            ? MessageTray.PrivacyScope.SYSTEM
            : MessageTray.PrivacyScope.USER;

        // Only fallback to 'app-icon' when the source doesn't have a valid app
        const sourceGIcon = source.app ? null : this._iconForNotificationData(appIcon);
        source.processNotification(notification, appName, sourceGIcon);

        return invocation.return_value(GLib.Variant.new('(u)', [id]));
    }

    CloseNotification(id) {
        const notification = this._notifications.get(id);
        notification?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    }

    GetCapabilities() {
        return [
            'actions',
            // 'action-icons',
            'body',
            // 'body-hyperlinks',
            // 'body-images',
            'body-markup',
            // 'icon-multi',
            'icon-static',
            'persistence',
            'sound',
        ];
    }

    GetServerInformation() {
        return [
            Config.PACKAGE_NAME,
            'GNOME',
            Config.PACKAGE_VERSION,
            '1.2'
        ];
    }

    // _emitNotificationClosed(id, reason) {
    //     this._dbusImpl.emit_signal('NotificationClosed',
    //         GLib.Variant.new('(uu)', [id, reason]));
    // }

    // _emitActionInvoked(id, action) {
    //     this._dbusImpl.emit_signal('ActionInvoked',
    //         GLib.Variant.new('(us)', [id, action]));
    // }

    // _emitActivationToken(source, id) {
    //     const context = global.create_app_launch_context(0, -1);
    //     const info = source.app?.get_app_info();
    //     if (info) {
    //         const token = context.get_startup_notify_id(info, []);
    //         this._dbusImpl.emit_signal('ActivationToken',
    //             GLib.Variant.new('(us)', [id, token]));
    //     }
    // }

    _onFocusAppChanged() {
        if (!this._sources.length)
            return;

        let tracker = Cinnamon.WindowTracker.get_default();
        if (!tracker.focus_app)
            return;

        let name = tracker.focus_app.get_name();
        if (name && AUTOCLEAR_BLACKLIST.includes(name.toLowerCase()))
            return;

        for (let i = 0; i < this._sources.length; i++) {
            let source = this._sources[i];
            if (source.app == tracker.focus_app) {
                source.destroyNonResidentNotifications();
                return;
            }
        }
    }

    _emitNotificationClosed(id, reason) {
        this._dbusImpl.emit_signal('NotificationClosed',
            GLib.Variant.new('(uu)', [id, reason]));
    }

    _emitActionInvoked(id, action) {
        this._dbusImpl.emit_signal('ActionInvoked',
            GLib.Variant.new('(us)', [id, action]));
    }
};

var NotificationSource = GObject.registerClass(
class NotificationSource extends MessageTray.Source {
    constructor(sender, app) {
        super({
            policy: MessageTray.NotificationPolicy.newForApp(app),
        });

        this.app = app;
        this._appName = null;
        this._appIcon = null;

        if (sender) {
            this._nameWatcherId = Gio.DBus.session.watch_name(sender,
              Gio.BusNameWatcherFlags.NONE,
              null,
              this._onNameVanished.bind(this));
        } else {
            this._nameWatcherId = 0;
        }
    }

    _onNameVanished() {
        // Destroy the notification source when its sender is removed from DBus.
        // Only do so if this.app is set to avoid removing "notify-send" sources, senders
        // of which are removed from DBus immediately.
        // Sender being removed from DBus would normally result in a tray icon being removed,
        // so allow the code path that handles the tray icon being removed to handle that case.
        if (this.app)
            this.destroy();
    }

    processNotification(notification, appName, appIcon) {
        if (!this.app && appName) {
            this._appName = appName;
            this.notify('title');
        }

        if (!this.app && appIcon) {
            this._appIcon = appIcon;
            this.notify('icon');
        }

        let tracker = Cinnamon.WindowTracker.get_default();
        // Acknowledge notifications that are resident and their app has the
        // current focus so that we don't show a banner.
        if (notification.resident && this.app && tracker.focus_app === this.app)
            notification.acknowledged = true;

        this.addNotification(notification);
    }

    open() {
        this.destroyNonResidentNotifications();
        this.openApp();
    }

    openApp() {
        if (this.app == null)
            return;

        let windows = this.app.get_windows();
        if (windows.length > 0) {
            let mostRecentWindow = windows[0];
            Main.activateWindow(mostRecentWindow);
        }
    }

    destroy() {
        if (this._nameWatcherId) {
            Gio.DBus.session.unwatch_name(this._nameWatcherId);
            this._nameWatcherId = 0;
        }

        super.destroy();
    }

    get title() {
        return this.app?.get_name() ?? this._appName;
    }

    get icon() {
        return this.app?.get_icon() ?? this._appIcon;
    }
});
