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

let nextNotificationId = 1;

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

// function NotificationDaemon() {
//     this._init();
// }

// NotificationDaemon.prototype = {
var NotificationDaemon = class NotificationDaemon {
    constructor() {
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(NotificationDaemonIface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/freedesktop/Notifications');

        this._sources = [];
        this._senderToPid = {};
        this._notifications = {};
        this._expireNotifications = []; // List of expiring notifications in order from first to last to expire.
        this._busProxy = new Bus();

        this._expireTimer = 0;

// Settings
        this.settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.notifications" });
        function setting(self, source, type, camelCase, dashed) {
            function updater() { self[camelCase] = source["get_"+type](dashed); }
            source.connect('changed::'+dashed, updater);
            updater();
        }
        setting(this, this.settings, "boolean", "removeOld", "remove-old");
        setting(this, this.settings, "int", "timeout", "timeout");

        Cinnamon.WindowTracker.get_default().connect('notify::focus-app',
            this._onFocusAppChanged.bind(this));
        Main.overview.connect('hidden', this._onFocusAppChanged.bind(this));
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

    _lookupSource(title, pid) {
        for (let i = 0; i < this._sources.length; i++) {
            let source = this._sources[i];
            if (source.pid == pid && source.initialTitle == title)
                return source;
        }
        return null;
    }

    // Returns the source associated with ndata.notification if it is set.
    // Otherwise, returns the source associated with the title and pid if
    // such source is stored in this._sources and the notification is not
    // transient. If the existing or requested source is associated with
    // a tray icon and passed in pid matches a pid of an existing source,
    // the title match is ignored to enable representing a tray icon and
    // notifications from the same application with a single source.
    //
    // If no existing source is found, a new source is created as long as
    // pid is provided.
    //
    // Either a pid or ndata.notification is needed to retrieve or
    // create a source.
    _getSource(title, pid, ndata, sender) {
        if (!pid && !(ndata && ndata.notification))
            return null;

        // We use notification's source for the notifications we still have
        // around that are getting replaced because we don't keep sources
        // for transient notifications in this._sources, but we still want
        // the notification associated with them to get replaced correctly.
        if (ndata && ndata.notification)
            return ndata.notification.source;

        let isForTransientNotification = (ndata && ndata.hints.maybeGet('transient') == true);

        // We don't want to override a persistent notification
        // with a transient one from the same sender, so we
        // always create a new source object for new transient notifications
        // and never add it to this._sources .
        if (!isForTransientNotification) {
            let source = this._lookupSource(title, pid);
            if (source) {
                return source;
            }
        }

        let source = new NotificationSource(title, pid, sender, ndata ? ndata.hints['desktop-entry'] : null);
        source.setTransient(isForTransientNotification);

        if (!isForTransientNotification) {
            this._sources.push(source);
            source.connect('destroy', () => {
                let index = this._sources.indexOf(source);
                if (index >= 0)
                    this._sources.splice(index, 1);
            });
        }

        if (Main.messageTray) Main.messageTray.add(source);
        return source;
    }

    _startExpire() {
         if (this.removeOld && this._expireNotifications.length && !this._expireTimer) {
            this._expireTimer = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                Math.max((this._expireNotifications[0].expires-Date.now())/1000, 1),
                this._expireNotification.bind(this));
        }
    }
    _stopExpire() {
         if (this._expireTimer == 0) {
            return;
        }
         GLib.source_remove(this._expireTimer);
         this._expireTimer = 0;
    }
    _restartExpire() {
         this._stopExpire();
         this._startExpire();
    }
    _expireNotification() {
        let ndata = this._expireNotifications[0];

        if (ndata) {
            ndata.notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
        }

        this._expireTimer = 0;
        return false;
    }

    // Sends a notification to the notification daemon. Returns the id allocated to the notification.
    NotifyAsync(params, invocation) {
        let [appName, replacesId, icon, summary, body, actions, hints, timeout] = params;
        let id;

        for (let hint in hints) {
            // unpack the variants
            hints[hint] = hints[hint].deep_unpack();
        }

        hints = Params.parse(hints, { urgency: Urgency.NORMAL }, true);

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

        hints['suppress-sound'] = hints.maybeGet('suppress-sound') == true;

        let ndata = { appName: appName,
                      icon: icon,
                      summary: summary,
                      body: body,
                      actions: actions,
                      hints: hints,
                      timeout: timeout };
        // Does this notification replace another?
        if (replacesId != 0 && this._notifications[replacesId]) {
            ndata.id = id = replacesId;
            ndata.notification = this._notifications[replacesId].notification;
        } else {
            replacesId = 0;
            ndata.id = id = nextNotificationId++;
        }
        this._notifications[id] = ndata;

        // Find expiration timestamp.
        let expires;
        if (!timeout || hints.resident || hints.urgency == 2) { // Never expires.
            expires = ndata.expires = 0;
        } else if (timeout == -1) { // Default expiration.
            expires = ndata.expires = Date.now()+this.timeout*1000;
        } else {    // Custom expiration.
             expires = ndata.expires = Date.now()+timeout;
        }

        // Does this notification expire?
        if (expires != 0) {
            // Find place in the notification queue.
            let notifications = this._expireNotifications, i;
            for (i = notifications.length; i > 0; --i) {    // Backwards search, likely to be faster.
                if (expires > notifications[i-1].expires) {
                    notifications.splice(i, 0, ndata);
                    break;
                }
            }
            if (i == 0) notifications.unshift(ndata);
            this._restartExpire()
        }

        let sender = invocation.get_sender();
        let pid = this._senderToPid[sender];

        let source = this._getSource(appName, pid, ndata, sender, null);

        if (source) {
            this._notifyForSource(source, ndata);
            return invocation.return_value(GLib.Variant.new('(u)', [id]));
        }

        if (replacesId) {
            // There's already a pending call to GetConnectionUnixProcessID,
            // which will see the new notification data when it finishes,
            // so we don't have to do anything.
            return invocation.return_value(GLib.Variant.new('(u)', [id]));
        }

        this._busProxy.GetConnectionUnixProcessIDRemote(sender, (result, excp) => {
            // The app may have updated or removed the notification
            ndata = this._notifications[id];
            if (!ndata)
                return;

            if (excp) {
                logError(excp, 'Call to GetConnectionUnixProcessID failed');
                return;
            }

            let [pid] = result;
            source = this._getSource(appName, pid, ndata, sender);

            // We only store sender-pid entries for persistent sources.
            // Removing the entries once the source is destroyed
            // would result in the entries associated with transient
            // sources removed once the notification is shown anyway.
            // However, keeping these pairs would mean that we would
            // possibly remove an entry associated with a persistent
            // source when a transient source for the same sender is
            // destroyed.
            if (!source.isTransient) {
                this._senderToPid[sender] = pid;
                source.connect('destroy', () => {
                    delete this._senderToPid[sender];
                });
            }
            this._notifyForSource(source, ndata);
        });

        return invocation.return_value(GLib.Variant.new('(u)', [id]));
    }

    _notifyForSource(source, ndata) {
        let [id, icon, summary, body, actions, hints, notification, timeout, expires] =
            [ndata.id, ndata.icon, ndata.summary, ndata.body,
             ndata.actions, ndata.hints, ndata.notification, ndata.timeout, ndata.expires];

        // let gicon = this._imageForNotificationData(hints);

        if (notification == null) {    // Create a new notification!
            notification = new MessageTray.Notification(source);
            // notification = new MessageTray.Notification(source, summary, body,
            //                                             { icon: gicon,
            //                                               bodyMarkup: true,
            //                                               silent: hints['suppress-sound'] });
            ndata.notification = notification;
            notification.connect('destroy', (n, reason) => {
                delete this._notifications[ndata.id];
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
                // Remove from expiring?
                if (ndata.expires) {
                    let notifications = this._expireNotifications;
                    for (var i = 0, j = notifications.length; i < j; ++i) {
                        if (notifications[i] == ndata) {
                            notifications.splice(i, 1);
                            break;
                         }
                    }
                    this._restartExpire();
                }
                this._emitNotificationClosed(ndata.id, notificationClosedReason);
            });
            notification.connect('action-invoked', (n, actionId) => {
                this._emitActionInvoked(ndata.id, actionId);
            });
        }
        // } else {
        //     notification.update(summary, body, { icon: gicon,
        //                                          bodyMarkup: true,
        //                                          silent: hints['suppress-sound'] });
        // }

        // We only display a large image if an icon is also specified.
        // if (icon && (hints['image-data'] || hints['image-path'])) {
        //     let image = null;
        //     if (hints['image-data']) {
        //         let [width, height, rowStride, hasAlpha,
        //          bitsPerSample, nChannels, data] = hints['image-data'];
        //         image = St.TextureCache.get_default().load_from_raw(data, hasAlpha,
        //                                                             width, height, rowStride, notification.IMAGE_SIZE);
        //     } else if (hints['image-path']) {
        //         image = St.TextureCache.get_default().load_uri_async(GLib.filename_to_uri(hints['image-path'], null),
        //                                                              notification.IMAGE_SIZE,
        //                                                              -1);
        //     }
        //     notification.setImage(image);
        // } else {
        //     notification.unsetImage();
        // }

        let gicon = this._imageForNotificationData(hints);

        if (!gicon)
            gicon = this._iconForNotificationData(icon);

        notification.update(summary, body, { gicon,
                                             bodyMarkup: true,
                                             silent: hints['suppress-sound'] });

        notification.clearButtons();

        if (actions.length) {
            notification.setUseActionIcons(hints.maybeGet('action-icons') == true);
            for (let i = 0; i < actions.length - 1; i += 2) {
                if (actions[i] == 'default')
                    notification.connect('action-invoked', () => {
                        this._emitActionInvoked(ndata.id, "default");
                    });
                else
                    notification.addButton(actions[i], actions[i + 1]);
            }
        }
        switch (hints.urgency) {
            case Urgency.LOW:
                notification.setUrgency(MessageTray.Urgency.LOW);
                break;
            case Urgency.NORMAL:
                notification.setUrgency(MessageTray.Urgency.NORMAL);
                break;
            case Urgency.CRITICAL:
                notification.setUrgency(MessageTray.Urgency.CRITICAL);
                break;
        }
        notification.setResident(hints.maybeGet('resident') == true);
        // 'transient' is a reserved keyword in JS, so we have to retrieve the value
        // of the 'transient' hint with hints['transient'] rather than hints.transient
        notification.setTransient(hints.maybeGet('transient') == true);

        let sourceGIcon = source.useNotificationIcon ? gicon : null;
        global.log("______________");
        global.log("sourceGIcon");
        global.log(source.useNotificationIcon);
        global.log(sourceGIcon);
        global.log("______________");
        source.processNotification(notification, sourceGIcon);
    }

    CloseNotification(id) {
        let ndata = this._notifications[id];
        if (ndata) {
            if (ndata.notification)
                ndata.notification.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
            delete this._notifications[id];
        }
    }

    GetCapabilities() {
        return [
            'actions',
            'action-icons',
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

// function Source(title, pid, sender, appId) {
//     this._init(title, pid, sender);
// }

// Source.prototype = {
//     __proto__:  MessageTray.Source.prototype,

// var NotificationSource = class NotificationSource extends MessageTray.Source {
var NotificationSource = GObject.registerClass(
class NotificationSource extends MessageTray.Source {
    _init(title, pid, sender, appId) {
        super._init(title);

        // MessageTray.Source.prototype._init.call(this, title);

        this.pid = pid;
        this.initialTitle = title;
        this.app = this._getApp(appId);
        global.log("__________");
        global.log("Source init");
        global.log(this.app);
        global.log("______________");

        if (this.app)
            this.title = this.app.get_name();
        else
            this.useNotificationIcon = true;

        if (sender)
            this._nameWatcherId = Gio.DBus.session.watch_name(sender,
              Gio.BusNameWatcherFlags.NONE,
              null,
              this._onNameVanished.bind(this));
        else
            this._nameWatcherId = 0;
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

    processNotification(notification, icon) {
        if (!this.app)
            this._setApp();
        if (!this.app && icon)
            this._setSummaryIcon(icon);

        this.showNotification(notification);
    }

    _getApp(appId) {
        const appSys = Cinnamon.AppSystem.get_default();
        let app;

        app = Cinnamon.WindowTracker.get_default().get_app_from_pid(this.pid);
        if (app != null)
            return app;

        if (appId)
            app = appSys.lookup_app('%s.desktop'.format(appId));

        if (!app)
            app = appSys.lookup_app('%s.desktop'.format(this.initialTitle));

        return app;
    }

    _setApp(appId) {
        if (this.app)
            return;

        this.app = this._getApp(appId);
        if (!this.app)
            return;


        this.useNotificationIcon = false;
        let icon = null;
        if (this.app.get_app_info() != null && this.app.get_app_info().get_icon() != null) {
            // icon = new St.Icon({gicon: this.app.get_app_info().get_icon(), icon_size: this.ICON_SIZE, icon_type: St.IconType.FULLCOLOR});
            icon = new Gio.ThemedIcon({ name: this.app.get_app_info().get_icon() });
        }
        if (icon == null) {
            // icon = new St.Icon({icon_name: "application-x-executable", icon_size: this.ICON_SIZE, icon_type: St.IconType.FULLCOLOR});
            icon = new Gio.ThemedIcon({ name: 'application-x-executable' });
        }

        this._setSummaryIcon(icon);
    }

    open(notification) {
        this.destroyNonResidentNotifications();
        this.openApp();
    }

    _lastNotificationRemoved() {
        this.destroy();
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
});
