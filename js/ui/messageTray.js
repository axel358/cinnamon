// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Atk = imports.gi.Atk;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const Cinnamon = imports.gi.Cinnamon;
const Signals = imports.signals;
const St = imports.gi.St;

const GnomeSession = imports.misc.gnomeSession;
// const Calendar = imports.ui.Calendar;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const MessageList = imports.ui.messageList;
const PopupMenu = imports.ui.popupMenu;
const Params = imports.misc.params;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;
const AppletManager = imports.ui.appletManager;

var ANIMATION_TIME = 200;

const NOTIFICATION_TIMEOUT = 4000;

var NOTIFICATION_CRITICAL_TIMEOUT_WITH_APPLET = 10000;
var SUMMARY_TIMEOUT = 1;
var LONGER_SUMMARY_TIMEOUT = 4;

var HIDE_TIMEOUT = 200;
var LONGER_HIDE_TIMEOUT = 600;

const MAX_NOTIFICATIONS_IN_QUEUE = 3;
const MAX_NOTIFICATIONS_PER_SOURCE = 3;

const MAX_NOTIFICATION_BUTTONS = 3;

const NOTIFICATION_IMAGE_SIZE = 125;
const NOTIFICATION_IMAGE_OPACITY = 230; // 0 - 255

const MOUSE_LEFT_ACTOR_THRESHOLD = 20;
const IDLE_TIME = 1000;

const DEFAULT_EXPAND_LINES = 6;

var State = {
    HIDDEN: 0,
    SHOWING: 1,
    SHOWN: 2,
    HIDING: 3
};

// These reasons are useful when we destroy the notifications received through
// the notification daemon. We use EXPIRED for transient notifications that the
// user did not interact with, DISMISSED for all other notifications that were
// destroyed as a result of a user action, and SOURCE_CLOSED for the notifications
// that were requested to be destroyed by the associated source.
var NotificationDestroyedReason = {
    EXPIRED: 1,
    DISMISSED: 2,
    SOURCE_CLOSED: 3,
    REPLACED: 4,
};

// Message tray has its custom Urgency enumeration. LOW, NORMAL and CRITICAL
// urgency values map to the corresponding values for the notifications received
// through the notification daemon. HIGH urgency value is used for chats received
// through the Telepathy client.
var Urgency = {
    LOW: 0,
    NORMAL: 1,
    HIGH: 2,
    CRITICAL: 3
};

var PrivacyScope = {
    USER: 0,
    SYSTEM: 1,
};

function _fixMarkup(text, allowMarkup) {
    if (allowMarkup) {
        // Support &amp;, &quot;, &apos;, &lt; and &gt;, escape all other
        // occurrences of '&'.
        let _text = text.replace(/&(?!amp;|quot;|apos;|lt;|gt;)/g, '&amp;');

        // Support <b>, <i>, and <u>, escape anything else
        // so it displays as raw markup.
        _text = _text.replace(/<(?!\/?[biu]>)/g, '&lt;');

        try {
            Pango.parse_markup(_text, -1, '');
            return _text;
        } catch (e) { }
    }

    // !allowMarkup, or invalid markup
    return GLib.markup_escape_text(text, -1);
}

class FocusGrabber {
    constructor(actor) {
        this._actor = actor;
        this._prevKeyFocusActor = null;
        this._focused = false;
    }

    grabFocus() {
        if (this._focused)
            return;

        this._prevKeyFocusActor = global.stage.get_key_focus();

        global.stage.connectObject('notify::key-focus',
            this._focusActorChanged.bind(this), this);

        // global.stage.connectObject('notify::key-focus',
        //     this._focusActorChanged.bind(this), this);

        // if (!this._actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false))
        //     this._actor.grab_key_focus();

        this._focused = true;
    }

    _focusUngrabbed() {
        if (!this._focused)
            return false;

        global.stage.disconnectObject(this);

        this._focused = false;
        return true;
    }

    _focusActorChanged() {
        let focusedActor = global.stage.get_key_focus();
        if (!focusedActor || !this._actor.contains(focusedActor))
            this._focusUngrabbed();
    }

    ungrabFocus() {
        if (!this._focusUngrabbed())
            return;

        if (this._prevKeyFocusActor) {
            global.stage.set_key_focus(this._prevKeyFocusActor);
            this._prevKeyFocusActor = null;
        } else {
            let focusedActor = global.stage.get_key_focus();
            if (focusedActor && this._actor.contains(focusedActor))
                global.stage.set_key_focus(null);
        }
    }
}

// const URLHighlighter = GObject.registerClass(
// class URLHighlighter extends St.Label {
// // var URLHighlighter = class URLHighlighter {
// //     constructor(text, lineWrap, allowMarkup) {
// //         if (!text)
// //             text = '';
//     _init(text = '', lineWrap, allowMarkup) {
//         super._init({
//             reactive: true,
//             style_class: 'url-highlighter',
//             x_expand: true,
//             x_align: Clutter.ActorAlign.START,
//         });
//         // this.actor = new St.Label({ reactive: true, style_class: 'url-highlighter' });
//         this._linkColor = '#ccccff';
//         this.connect('style-changed', () => {
//             let [hasColor, color] = this.get_theme_node().lookup_color('link-color', false);
//             if (hasColor) {
//                 let linkColor = color.to_string().substr(0, 7);
//                 if (linkColor != this._linkColor) {
//                     this._linkColor = linkColor;
//                     this._highlightUrls();
//                 }
//             }
//         });
//         this.clutter_text.line_wrap = lineWrap;
//         this.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
//         // if (lineWrap) {
//         //     this.actor.clutter_text.line_wrap = true;
//         //     this.actor.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
//         //     this.actor.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
//         // }

//         this.setMarkup(text, allowMarkup);
//         // this.actor.connect('button-press-event', (actor, event) => {
//         //     // Don't try to URL highlight when invisible.
//         //     // The MessageTray doesn't actually hide us, so
//         //     // we need to check for paint opacities as well.
//         //     if (!actor.visible || actor.get_paint_opacity() == 0)
//         //         return false;

//         //     // Keep Notification.actor from seeing this and taking
//         //     // a pointer grab, which would block our button-release-event
//         //     // handler, if an URL is clicked
//         //     return this._findUrlAtPos(event) != -1;
//         // });
//         // this.actor.connect('button-release-event', (actor, event) => {
//         //     if (!actor.visible || actor.get_paint_opacity() == 0)
//         //         return false;

//         //     let urlId = this._findUrlAtPos(event);
//         //     if (urlId != -1) {
//         //         let url = this._urls[urlId].url;
//         //         if (url.indexOf(':') == -1)
//         //             url = 'http://' + url;
//         //         try {
//         //             Gio.app_info_launch_default_for_uri(url, global.create_app_launch_context());
//         //             return true;
//         //         } catch (e) {
//         //             // TODO: remove this after gnome 3 release
//         //             Util.spawn(['gio', 'open', url]);
//         //             return true;
//         //         }
//         //     }
//         //     return false;
//         // });
//         // this.actor.connect('motion-event', (actor, event) => {
//         //     if (!actor.visible || actor.get_paint_opacity() == 0)
//         //         return false;

//         //     let urlId = this._findUrlAtPos(event);
//         //     if (urlId != -1 && !this._cursorChanged) {
//         //         global.set_cursor(Cinnamon.Cursor.POINTING_HAND);
//         //         this._cursorChanged = true;
//         //     } else if (urlId == -1) {
//         //         global.unset_cursor();
//         //         this._cursorChanged = false;
//         //     }
//         //     return false;
//         // });
//         // this.actor.connect('leave-event', () => {
//         //     if (!this.actor.visible || this.actor.get_paint_opacity() == 0)
//         //         return;

//         //     if (this._cursorChanged) {
//         //         this._cursorChanged = false;
//         //         global.unset_cursor();
//         //     }
//         // });
//     }

//     vfunc_button_press_event(event) {
//         // Don't try to URL highlight when invisible.
//         // The MessageTray doesn't actually hide us, so
//         // we need to check for paint opacities as well.
//         if (!this.visible || this.get_paint_opacity() === 0)
//             return Clutter.EVENT_PROPAGATE;

//         // Keep Notification from seeing this and taking
//         // a pointer grab, which would block our button-release-event
//         // handler, if an URL is clicked
//         return this._findUrlAtPos(event) !== -1;
//     }

//     vfunc_button_release_event(event) {
//         if (!this.visible || this.get_paint_opacity() === 0)
//             return Clutter.EVENT_PROPAGATE;

//         const urlId = this._findUrlAtPos(event);
//         if (urlId !== -1) {
//             let url = this._urls[urlId].url;
//             if (!url.includes(':'))
//                 url = `http://${url}`;
//             try {
//                 Gio.app_info_launch_default_for_uri(url, global.create_app_launch_context());
//                 return true;
//             } catch (e) {
//                 // TODO: remove this after gnome 3 release
//                 Util.spawn(['gio', 'open', url]);
//                 return true;
//                 }

//             // Gio.app_info_launch_default_for_uri(
//             //     url, global.create_app_launch_context(0, -1));
//             // return Clutter.EVENT_STOP;
//         }
//         return Clutter.EVENT_PROPAGATE;
//     }

//     vfunc_motion_event(event) {
//         if (!this.visible || this.get_paint_opacity() === 0)
//             return Clutter.EVENT_PROPAGATE;

//         const urlId = this._findUrlAtPos(event);
//         if (urlId !== -1 && !this._cursorChanged) {
//             global.set_cursor(Cinnamon.Cursor.POINTING_HAND);
//             this._cursorChanged = true;
//         } else if (urlId === -1) {
//             global.unset_cursor();
//             this._cursorChanged = false;
//         }
//         return Clutter.EVENT_PROPAGATE;
//     }

//     vfunc_leave_event(event) {
//         if (!this.visible || this.get_paint_opacity() === 0)
//             return Clutter.EVENT_PROPAGATE;

//         if (this._cursorChanged) {
//             this._cursorChanged = false;
//             global.unset_cursor();
//         }
//         return super.vfunc_leave_event(event);
//     }

//     setMarkup(text, allowMarkup) {
//         text = text ? _fixMarkup(text, allowMarkup) : '';
//         this._text = text;

//         this.clutter_text.set_markup(text);
//         /* clutter_text.text contain text without markup */
//         this._urls = Util.findUrls(this.clutter_text.text);
//         this._highlightUrls();
//     }

//     _highlightUrls() {
//         // text here contain markup
//         let urls = Util.findUrls(this._text);
//         let markup = '';
//         let pos = 0;
//         for (let i = 0; i < urls.length; i++) {
//             let url = urls[i];
//             let str = this._text.substr(pos, url.pos - pos);
//             markup += str + '<span foreground="' + this._linkColor + '"><u>' + url.url + '</u></span>';
//             pos = url.pos + url.url.length;
//         }
//         markup += this._text.substr(pos);
//         this.clutter_text.set_markup(markup);
//     }

//     _findUrlAtPos(event) {
//         if (!this._urls.length)
//             return -1;

//         let success;
//         let [x, y] = event.get_coords();
//         let ct = this.clutter_text;
//         [success, x, y] = ct.transform_stage_point(x, y);
//         if (success && x >= 0 && x <= ct.width
//             && y >= 0 && y <= ct.height) {
//             let pos = ct.coords_to_position(x, y);
//             for (let i = 0; i < this._urls.length; i++) {
//                 let url = this._urls[i]
//                 if (pos >= url.pos && pos <= url.pos + url.url.length)
//                     return i;
//             }
//         }
//         return -1;
//     }
// });

// const LabelExpanderLayout = GObject.registerClass({
//     Properties: {
//         'expansion': GObject.ParamSpec.double(
//             'expansion', 'Expansion', 'Expansion',
//             GObject.ParamFlags.READABLE | GObject.ParamFlags.WRITABLE,
//             0, 1, 0),
//     },
// }, class LabelExpanderLayout extends Clutter.BinLayout {
//     constructor(params) {
//         super(params);

//         this._expansion = 0;
//         this._expandLines = DEFAULT_EXPAND_LINES;
//     }

//     get expansion() {
//         return this._expansion;
//     }

//     set expansion(v) {
//         if (v === this._expansion)
//             return;
//         this._expansion = v;
//         this.notify('expansion');

//         this.layout_changed();
//     }

//     set expandLines(v) {
//         if (v === this._expandLines)
//             return;
//         this._expandLines = v;
//         if (this._expansion > 0)
//             this.layout_changed();
//     }

//     vfunc_get_preferred_height(container, forWidth) {
//         let [min, nat] = [0, 0];

//         const [child] = container;

//         if (child) {
//             [min, nat] = child.get_preferred_height(-1);

//             const [, nat2] = child.get_preferred_height(forWidth);
//             const expHeight =
//                 Math.min(nat2, nat * this._expandLines);
//             [min, nat] = [
//                 min + this._expansion * (expHeight - min),
//                 nat + this._expansion * (expHeight - nat),
//             ];
//         }

//         return [min, nat];
//     }
// });

// var NotificationHeader = GObject.registerClass(
// class NotificationHeader extends St.BoxLayout {
//     constructor(source) {
//         super({
//             style_class: 'message-header',
//             x_expand: true,
//         });

//         const sourceIconEffect = new Clutter.DesaturateEffect();
//         const sourceIcon = new St.Icon({
//             style_class: 'message-source-icon',
//             y_align: Clutter.ActorAlign.CENTER,
//             fallback_icon_name: 'application-x-executable-symbolic',
//         });
//         sourceIcon.add_effect(sourceIconEffect);
//         this.add_child(sourceIcon);

//         const headerContent = new St.BoxLayout({
//             style_class: 'message-header-content',
//             y_align: Clutter.ActorAlign.CENTER,
//             x_expand: true,
//         });
//         this.add_child(headerContent);

//         this.closeButton = new St.Button({
//             style_class: 'message-close-button',
//             icon_name: 'window-close-symbolic',
//             y_align: Clutter.ActorAlign.CENTER,
//             // opacity: 0,
//         });
//         this.add_child(this.closeButton);

//         const sourceTitle = new St.Label({
//             style_class: 'message-source-title',
//             y_align: Clutter.ActorAlign.END,
//         });
//         headerContent.add_child(sourceTitle);

//         source.bind_property_full('title',
//             sourceTitle,
//             'text',
//             GObject.BindingFlags.SYNC_CREATE,
//             // Translators: this is the string displayed in the header when a message
//             // source doesn't have a name
//             (bind, value) => [true, value === null || value === '' ? _('Unknown App') : value],
//             null);
//         source.bind_property('icon',
//             sourceIcon,
//             'gicon',
//             GObject.BindingFlags.SYNC_CREATE);
//     }
// });

var NotificationPolicy = GObject.registerClass({
    GTypeFlags: GObject.TypeFlags.ABSTRACT,
    Properties: {
        'enable': GObject.ParamSpec.boolean(
            'enable', 'enable', 'enable', GObject.ParamFlags.READABLE, true),
        'enable-sound': GObject.ParamSpec.boolean(
            'enable-sound', 'enable-sound', 'enable-sound',
            GObject.ParamFlags.READABLE, true),
        'show-banners': GObject.ParamSpec.boolean(
            'show-banners', 'show-banners', 'show-banners',
            GObject.ParamFlags.READABLE, true),
        'force-expanded': GObject.ParamSpec.boolean(
            'force-expanded', 'force-expanded', 'force-expanded',
            GObject.ParamFlags.READABLE, false),
        'show-in-lock-screen': GObject.ParamSpec.boolean(
            'show-in-lock-screen', 'show-in-lock-screen', 'show-in-lock-screen',
            GObject.ParamFlags.READABLE, false),
        'details-in-lock-screen': GObject.ParamSpec.boolean(
            'details-in-lock-screen', 'details-in-lock-screen', 'details-in-lock-screen',
            GObject.ParamFlags.READABLE, false),
    },
}, class NotificationPolicy extends GObject.Object {
    /**
     * Create a new policy for app.
     *
     * This will be a NotificationApplicationPolicy for valid apps,
     * or a NotificationGenericPolicy otherwise.
     *
     * @param {Shell.App=} app
     * @returns {NotificationPolicy}
     */
    static newForApp(app) {
        // fallback to generic policy
        if (!app?.get_app_info())
            return new NotificationGenericPolicy();

        const id = app.get_id().replace(/\.desktop$/, '');
        return new NotificationApplicationPolicy(id);
    }

    // Do nothing for the default policy. These methods are only useful for the
    // GSettings policy.
    store() { }

    destroy() {
        this.run_dispose();
    }

    get enable() {
        return true;
    }

    get enableSound() {
        return true;
    }

    get showBanners() {
        return true;
    }

    get forceExpanded() {
        return false;
    }

    get showInLockScreen() {
        return false;
    }

    get detailsInLockScreen() {
        return false;
    }
});

var NotificationGenericPolicy = GObject.registerClass({
}, class NotificationGenericPolicy extends NotificationPolicy {
    _init() {
        super._init();
        this.id = 'generic';

        // this._masterSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        // this._masterSettings.connect('changed', this._changed.bind(this));
    }

    destroy() {
        // this._masterSettings.run_dispose();

        super.destroy();
    }

    // _changed(settings, key) {
    //     if (this.constructor.find_property(key))
    //         this.notify(key);
    // }

    get showBanners() {
        // return this._masterSettings.get_boolean('show-banners');
        return true;
    }

    get showInLockScreen() {
        // return this._masterSettings.get_boolean('show-in-lock-screen');
        return true;
    }
});

var NotificationApplicationPolicy = GObject.registerClass({
}, class NotificationApplicationPolicy extends NotificationPolicy {
    _init(id) {
        super._init();

        this.id = id;
        this._canonicalId = this._canonicalizeId(id);

        // this._masterSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        // this._settings = new Gio.Settings({
        //     schema_id: 'org.gnome.desktop.notifications.application',
        //     path: `/org/gnome/desktop/notifications/application/${this._canonicalId}/`,
        // });

        // this._masterSettings.connect('changed', this._changed.bind(this));
        // this._settings.connect('changed', this._changed.bind(this));
    }

    store() {
        // this._settings.set_string('application-id', `${this.id}.desktop`);

        // let apps = this._masterSettings.get_strv('application-children');
        // if (!apps.includes(this._canonicalId)) {
        //     apps.push(this._canonicalId);
        //     this._masterSettings.set_strv('application-children', apps);
        // }
    }

    destroy() {
        // this._masterSettings.run_dispose();
        // this._settings.run_dispose();

        super.destroy();
    }

    // _changed(settings, key) {
    //     if (this.constructor.find_property(key))
    //         this.notify(key);
    // }

    _canonicalizeId(id) {
        // Keys are restricted to lowercase alphanumeric characters and dash,
        // and two dashes cannot be in succession
        return id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/--+/g, '-');
    }

    get enable() {
        // return this._settings.get_boolean('enable');
        return true;
    }

    get enableSound() {
        // return this._settings.get_boolean('enable-sound-alerts');
        return true;
    }

    get showBanners() {
        // return this._masterSettings.get_boolean('show-banners') &&
        //     this._settings.get_boolean('show-banners');
        return true;
    }

    get forceExpanded() {
        // return this._settings.get_boolean('force-expanded');
        return false;
    }

    get showInLockScreen() {
        // return this._masterSettings.get_boolean('show-in-lock-screen') &&
        //     this._settings.get_boolean('show-in-lock-screen');
        return true;
    }

    get detailsInLockScreen() {
        // return this._settings.get_boolean('details-in-lock-screen');
        return true;
    }
});

var Action = GObject.registerClass(
class Action extends GObject.Object {
    constructor(label, callback) {
        super();

        this._label = label;
        this._callback = callback;
    }

    get label() {
        return this._label;
    }

    activate() {
        this._callback();
    }
});

var NotificationMessage = GObject.registerClass(
class NotificationMessage extends MessageList.Message {
    constructor(notification) {
        super(notification.source);

        this.notification = notification;

        this.connect('close', () => {
            this._closed = true;
            if (this.notification)
                this.notification.destroy(NotificationDestroyedReason.DISMISSED);
        });

        // this._destroyId = notification.connect('destroy', () => {
        //     this._disconnectNotificationSignals();
        //     this.notification = null;
        //     if (!this._closed)
        //         this.close();
        // });

        // notification.connect('action-added', (_, action) => this._addAction(action));
        // notification.connect('action-removed', (_, action) => this._removeAction(action));
        notification.connectObject(
            'action-added', (_, action) => this._addAction(action),
            'action-removed', (_, action) => this._removeAction(action),
            'destroy', () => {
                this.notification = null;
                if (!this._closed)
                    this.close();
            }, this);

        notification.bind_property('title',
            this, 'title',
            GObject.BindingFlags.SYNC_CREATE);
        notification.bind_property('body',
            this, 'body',
            GObject.BindingFlags.SYNC_CREATE);
        notification.bind_property('use-body-markup',
            this, 'use-body-markup',
            GObject.BindingFlags.SYNC_CREATE);
        notification.bind_property('datetime',
            this, 'datetime',
            GObject.BindingFlags.SYNC_CREATE);
        notification.bind_property('gicon',
            this, 'icon',
            GObject.BindingFlags.SYNC_CREATE);

        this._actions = new Map();
        this.notification.actions.forEach(action => {
            this._addAction(action);
        });
    }

    vfunc_clicked() {
        this.notification.activate();
    }

    _disconnectNotificationSignals() {
        if (this._destroyId)
            this.notification.disconnect(this._destroyId);
        this._destroyId = 0;
    }

    canClose() {
        return true;
    }

    _addAction(action) {
        if (!this._buttonBox) {
            this._buttonBox = new St.BoxLayout({
                x_expand: true,
                style_class: 'notification-buttons-bin',
            });
            this.setActionArea(this._buttonBox);
            global.focus_manager.add_group(this._buttonBox);
        }

        if (this._buttonBox.get_n_children() >= MAX_NOTIFICATION_BUTTONS)
            return;

        const button = new St.Button({
            style_class: 'notification-button',
            x_expand: true,
            label: action.label,
        });

        button.connect('clicked', () => action.activate());

        this._actions.set(action, button);
        this._buttonBox.add_child(button);
    }

    _removeAction(action) {
        this._actions.get(action)?.destroy();
        this._actions.delete(action);
    }
});

/**
 * #Notification:
 * @short_description: A Cinnamon notification.
 * @source (object): The notification's Source
 * @title (string): The title/summary text
 * @body (string): Optional - body text
 * @params (object): Optional - additional params
 *
 * Creates a notification with the associated title and body
 *
 * @params can contain values for 'body', 'icon', 'titleMarkup',
 * 'bodyMarkup', and 'silent' parameters.
 *
 * By default, the icon shown is created by calling
 * source.createNotificationIcon(). However, if @params contains an 'icon'
 * parameter, the passed in icon will be shown.
 *
 * If @params contains a 'titleMarkup', or 'bodyMarkup' parameter
 * with the value %true, then the corresponding element is assumed to
 * use pango markup. If the parameter is not present for an element,
 * then anything that looks like markup in that element will appear
 * literally in the output.
 *
 * If @params contains a 'silent' parameter with the value %true, then
 * the associated sound effects are suppressed. Note that notifications
 * with an URGENT priority will always play a sound effect if there is
 * one set.
 */

// var Notification = GObject.registerClass({
//     GTypeName: 'MessageTray_Notification',
//     Signals: {
//         'activated': {},
//         'action-invoked': { param_types: [GObject.TYPE_UINT] },
//         'done-displaying': {},
//         'destroy': { param_types: [GObject.TYPE_UINT] },
//         'updated': { param_types: [GObject.TYPE_BOOLEAN] },
//     }
// }, class Notification extends GObject.Object {
var Notification = class Notification extends GObject.Object {
   constructor(params) {
        super(params);

        this._actions = [];

        // title = Util.decodeHTML(title);
        // body = Util.decodeHTML(body);

        // this.source = source;
        // this.title = title;
        // this.urgency = Urgency.NORMAL;
        // this.resident = false;
        // // 'transient' is a reserved keyword in JS, so we have to use an alternate variable name
        // this.isTransient = false;
        // this.silent = false;
        // this._destroyed = false;
        // this._useActionIcons = false;
        // this._titleDirection = St.TextDirection.NONE;
        // // this._scrollArea = null;
        // this._actionArea = null;
        // // this._imageBin = null;
        // this._timestamp = new Date();
        // this._inNotificationBin = false;

        // this.expanded = false;

        // source.connect('destroy', (source, reason) => { this.destroy(reason) });

        // this.actor = new St.Button({
        //     style_class: 'message',
        //     accessible_role: Atk.Role.NOTIFICATION,
        //     x_fill: true,
        // });
        // this.actor._parent_container = null;
        // this.actor.connect('clicked', () => this.activate());
        // this.actor.connect('destroy', () => this._onDestroy());

        // let vbox = new St.BoxLayout({
        //     vertical: true,
        //     x_expand: true,
        // });
        // this.actor.set_child(vbox);

        // this._header = new NotificationHeader(source);
        // vbox.add_child(this._header);

        // const hbox = new St.BoxLayout({
        //     style_class: 'message-box',
        // });
        // vbox.add_child(hbox);

        // this._actionBin = new St.Widget({
        //     style_class: 'message-action-bin',
        //     visible: false,
        //     layout_manager: new Clutter.BoxLayout({
        //         homogeneous: true,
        //     }),
        // });
        // vbox.add_child(this._actionBin);

        // this._icon = new St.Icon({
        //     style_class: 'message-icon',
        //     y_expand: true,
        //     y_align: Clutter.ActorAlign.START,
        //     visible: true,
        //     // icon_name: 'help-about-symbolic',
        // });
        // hbox.add_child(this._icon);

        // const contentBox = new St.BoxLayout({
        //     style_class: 'message-content',
        //     vertical: true,
        //     x_expand: true,
        // });
        // hbox.add_child(contentBox);

        // this.titleLabel = new St.Label({
        //     style_class: 'message-title',
        //     y_align: Clutter.ActorAlign.END,
        // });
        // contentBox.add_child(this.titleLabel);

        // this._bodyLabel = new URLHighlighter("", true, false);
        // this._bodyLabel.add_style_class_name('message-body');
        // this._bodyBin = new St.Bin({
        //     x_expand: true,
        //     x_fill: true,
        //     layout_manager: new LabelExpanderLayout(),
        //     child: this._bodyLabel,
        // });
        // contentBox.add_child(this._bodyBin);

        // // this._header.closeButton.connect('clicked', this.close.bind(this));

        // this._buttonFocusManager = St.FocusManager.get_for_stage(global.stage);

        // if (arguments.length != 1)
        //     this.update(title, body, params);
    }

    // close() {
    //     this.emit('close');
    // }

    // for backwards compatibility with old class constant
    // get IMAGE_SIZE() { return NOTIFICATION_IMAGE_SIZE; }

    /**
     * update:
     * @title (string): the new title
     * @body (string): the new body
     * @params (object): as in the Notification constructor
     *
     * Updates the notification timestamp, title, and body and
     * regenerates the icon.
     */
    // update(title, body, params) {
    //     this._timestamp = new Date();
    //     this._inNotificationBin = false;
    //     params = Params.parse(params, {
    //         gicon: null,
    //         titleMarkup: false,
    //         bodyMarkup: false,
    //         silent: false
    //     });

    //     // if (params.gicon) {
    //     //     this._sourceIcon.gicon = new Gio.ThemedIcon({ name: 'applications-system-symbolic' });
    //     //     // this._sourceIcon.gicon = params.gicon;
    //     //     this._icon.gicon = params.gicon;
    //     // }

    //     this.silent = params.silent;

    //     // title: strip newlines, escape or validate markup, add bold markup
    //     if (typeof (title) === "string") {
    //         this.title = _fixMarkup(title.replace(/\n/g, ' '), params.titleMarkup);
    //     } else {
    //         this.title = "";
    //     }
    //     this.titleLabel.set_text(this.title);

    //     if (params.gicon)
    //         this._icon.gicon = params.gicon;

    //     // this._timeLabel.clutter_text.set_markup(this._timestamp.toLocaleTimeString());
    //     // this._timeLabel.hide();

    //     this._setBodyArea(body, params.bodyMarkup);
    //     this.emit('updated', true);
    // }

    // _setBodyArea(text, allowMarkup) {
    //     if (text) {
    //         this._bodyLabel.setMarkup(text, allowMarkup);
    //     }
    //     this._updateLayout();
    // }

    // setIconVisible(visible) {
    //     if (this._icon)
    //         this._icon.visible = visible;
    // }

    /**
      * scrollTo:
      * @side (St.Side): St.Side.TOP or St.Side.BOTTOM
      *
      * Scrolls the content area (if scrollable) to the indicated edge
      */
    // scrollTo(side) {
    //     if (true)
    //         return;
    // }

    // _updateLayout() {
    // }

    /**
     * addButton:
     * @id (number): the action ID
     * @label (string): the label for the action's button
     *
     * Adds a button with the given @label to the notification. All
     * action buttons will appear in a single row at the bottom of
     * the notification.
     *
     * If the button is clicked, the notification will emit the
     * %action-invoked signal with @id as a parameter.
     */
    // addButton(id, label) {
    //     if (!this._actionBin.visible)
    //         this._actionBin.visible = true;

    //     let button = new St.Button({
    //         can_focus: true,
    //         x_expand: true,
    //     });

    //     if (this._useActionIcons
    //         && id.endsWith("-symbolic")
    //         && Gtk.IconTheme.get_default().has_icon(id)) {
    //         button.add_style_class_name('notification-icon-button');
    //         button.child = new St.Icon({ icon_name: id });
    //     } else {
    //         button.add_style_class_name('notification-button');
    //         button.label = label;
    //     }

    //     if (this._actionBin.get_n_children() > 0)
    //         this._buttonFocusManager.remove_group(this._actionBin);

    //     this._actionBin.add_actor(button);
    //     this._buttonFocusManager.add_group(this._actionBin);
    //     global.log(id);
    //     button.connect('clicked', Lang.bind(this, this._onActionInvoked, id));
    //     // button.connect('clicked', () => {
    //     //     this._onActionInvoked(button, mouseButtonClicked, id);
    //     // });
    //     this._updateLayout();
    // }

    /**
     * clearButtons:
     *
     * Removes all buttons.
     */
    // clearButtons() {
    //     if (!this._actionArea)
    //         return;
    //     this._actionArea.destroy();
    //     this._actionArea = null;
    //     this._updateLayout();
    // }

    get actions() {
        return this._actions;
    }

    get iconName() {
        if (this.gicon instanceof Gio.ThemedIcon)
            return this.gicon.iconName;
        else
            return null;
    }

    set iconName(iconName) {
        this.gicon = new Gio.ThemedIcon({name: iconName});
    }

    set privacyScope(privacyScope) {
        if (!Object.values(PrivacyScope).includes(privacyScope))
            throw new Error('out of range');

        if (this._privacyScope === privacyScope)
            return;

        this._privacyScope = privacyScope;
        this.notify('privacy-scope');
    }

    get urgency() {
        return this._urgency;
    }

    set urgency(urgency) {
        if (!Object.values(Urgency).includes(urgency))
            throw new Error('out of range');

        if (this._urgency === urgency)
            return;

        this._urgency = urgency;
        this.notify('urgency');
    }

    // setUrgency(urgency) {
    //     this.urgency = urgency;
    // }

    // setResident(resident) {
    //     this.resident = resident;
    // }

    // setTransient(isTransient) {
    //     this.isTransient = isTransient;
    // }

    // setUseActionIcons(useIcons) {
    //     this._useActionIcons = useIcons;
    // }

    // addAction:
    // @label: the label for the action's button
    // @callback: the callback for the action
    addAction(label, callback) {
        const action = new Action(label, () => {
            callback();

            // We don't hide a resident notification when the user invokes one of its actions,
            // because it is common for such notifications to update themselves with new
            // information based on the action. We'd like to display the updated information
            // in place, rather than pop-up a new notification.
            if (this.resident)
                return;

            this.destroy();
        });
        this._actions.push(action);
        this.emit('action-added', action);
    }

    clearActions() {
        if (this._actions.length === 0)
            return;

        this._actions.forEach(action => {
            this.emit('action-removed', action);
        });
        this._actions = [];
    }

    // _onActionInvoked(actor, mouseButtonClicked, id) {
    //     this.emit('action-invoked', id);
    //     if (!this.resident) {
    //         // We don't hide a resident notification when the user invokes one of its actions,
    //         // because it is common for such notifications to update themselves with new
    //         // information based on the action. We'd like to display the updated information
    //         // in place, rather than pop-up a new notification.
    //         this.emit('done-displaying');
    //         this.destroy();
    //     }
    // }

    activate() {
        this.emit('activated');
        // We hide all types of notifications once the user clicks on them because the common
        // outcome of clicking should be the relevant window being brought forward and the user's
        // attention switching to the window.
        // this.emit('done-displaying');
        // if (!this.resident)
        //     this.destroy();
        if (this.resident)
            return;

        this.destroy();
    }

    // _onDestroy() {
    //     if (this._destroyed)
    //         return;
    //     this._destroyed = true;
    //     if (!this._destroyedReason)
    //         this._destroyedReason = NotificationDestroyedReason.DISMISSED;
    //     this.emit('destroy', this._destroyedReason);
    //     // this.disconnectAll();
    // }

    destroy(reason = NotificationDestroyedReason.DISMISSED) {
        if (this._activatedId) {
            this.disconnect(this._activatedId);
            delete this._activatedId;
        }
        this.emit('destroy', reason);
        // this._destroyedReason = reason;
        // this.actor.destroy();
        this.run_dispose();
    }
}

// var BaseSource = GObject.registerClass({
//     Properties: {
//         'title': GObject.ParamSpec.string(
//             'title', 'title', 'title',
//             GObject.ParamFlags.READWRITE,
//             null),
//         'icon': GObject.ParamSpec.object(
//             'icon', 'icon', 'icon',
//             GObject.ParamFlags.READWRITE,
//             Gio.Icon),
//         'icon-name': GObject.ParamSpec.string(
//             'icon-name', 'icon-name', 'icon-name',
//             GObject.ParamFlags.READWRITE,
//             null),
//     },
// }, class BaseSource extends GObject.Object {
//     get iconName() {
//         if (this.gicon instanceof Gio.ThemedIcon)
//             return this.gicon.iconName;
//         else
//             return null;
//     }

//     set iconName(iconName) {
//         this.icon = new Gio.ThemedIcon({name: iconName});
//     }
// });

var Source = GObject.registerClass({
    Properties: {
        'count': GObject.ParamSpec.int(
            'count', 'count', 'count',
            GObject.ParamFlags.READABLE,
            0, GLib.MAXINT32, 0),
        'policy': GObject.ParamSpec.object(
            'policy', 'policy', 'policy',
            GObject.ParamFlags.READWRITE,
            NotificationPolicy.$gtype),
    },
    Signals: {
        'destroy': { param_types: [GObject.TYPE_UINT] },
        'notification-added': { param_types: [Notification.$gtype] },
        'notification-removed': { param_types: [Notification.$gtype] },
        'notification-request-banner': {param_types: [Notification.$gtype]},
    }
}, class Source extends MessageList.BaseSource {
    constructor(params) {
        super(params);

        // this.ICON_SIZE = 24;
        // this.MAX_NOTIFICATIONS = 10;

        // this.title = title;
        // if (iconName)
        //     this.icon = new Gio.ThemedIcon({ name: iconName });

        // this.actor = new St.Bin({
        //     x_fill: true,
        //     y_fill: true
        // });
        // this.actor.connect('destroy', () => { this._actorDestroyed = true });
        // this._actorDestroyed = false;

        // this.isTransient = false;
        // this.isChat = false;

        this.notifications = [];

        if (!this._policy)
            this._policy = new NotificationGenericPolicy();
    }

    get policy() {
        return this._policy;
    }

    set policy(policy) {
        if (this._policy)
            this._policy.destroy();
        this._policy = policy;
    }

    get count() {
        return this.notifications.length;
    }

    get unseenCount() {
        return this.notifications.filter(n => !n.acknowledged).length;
    }

    get countVisible() {
        return this.count > 1;
    }

    countUpdated() {
        this.notify('count');
    }

    get narrowestPrivacyScope() {
        return this.notifications.every(n => n.privacyScope === PrivacyScope.SYSTEM)
            ? PrivacyScope.SYSTEM
            : PrivacyScope.USER;
    }

    // _updateCount() {
    //     let count = this.notifications.length;
    //     if (count > this.MAX_NOTIFICATIONS) {
    //         let oldestNotif = this.notifications.shift();
    //         oldestNotif.destroy();
    //     }
    // }

    setTransient(isTransient) {
        this.isTransient = isTransient;
    }

    _onNotificationDestroy(notification) {
        let index = this.notifications.indexOf(notification);
        if (index < 0)
            throw new Error('Notification was already removed previously');

        this.notifications.splice(index, 1);
        this.emit('notification-removed', notification);
        this.countUpdated();

        if (!this._inDestruction && this.notifications.length === 0)
            this.destroy();
    }

    addNotification(notification) {
        if (this.notifications.includes(notification))
            return;

        while (this.notifications.length >= MAX_NOTIFICATIONS_PER_SOURCE) {
            const [oldest] = this.notifications;
            oldest.destroy(NotificationDestroyedReason.EXPIRED);
        }

        notification.connect('destroy', this._onNotificationDestroy.bind(this));
        notification.connect('notify::acknowledged', () => {
            this.countUpdated();

            // If acknowledged was set to false try to show the notification again
            if (!notification.acknowledged)
                this.emit('notification-request-banner', notification);
        });
        this.notifications.push(notification);

        this.emit('notification-added', notification);
        this.emit('notification-request-banner', notification);
        this.countUpdated();
    }

    // Called to create a new icon actor (of size this.ICON_SIZE).
    // Must be overridden by the subclass if you do not pass icons
    // explicitly to the Notification() constructor.
    // createNotificationIcon() {
    //     throw new Error('no implementation of createNotificationIcon in ' + this);
    // }

    // Unlike createNotificationIcon, this always returns the same actor;
    // there is only one summary icon actor for a Source.
    // getSummaryIcon() {
    //     return this.actor;
    // }

    // pushNotification(notification) {
    //     if (this.notifications.indexOf(notification) < 0) {
    //         this.notifications.push(notification);
    //         this.emit('notification-added', notification);
    //     }

    //     notification.connect('activated', () => { this.open() });
    //     notification.connect('destroy', () => {
    //         let index = this.notifications.indexOf(notification);
    //         if (index < 0)
    //             return;

    //         this.notifications.splice(index, 1);
    //         if (this.notifications.length == 0)
    //             this._lastNotificationRemoved();
    //     });

    //     this._updateCount();
    // }

    // showNotification(notification) {
    //     this.pushNotification(notification);
    //     this.emit('notification-show', notification);
    // }

    // notify(propName) {
    //     if (propName instanceof Notification) {
    //         try {
    //             throw new Error('Source.notify() has been moved to Source.showNotification()' +
    //                             'this code will break in the future.');
    //         } catch (e) {
    //             logError(e);
    //             this.showNotification(propName);
    //             return;
    //         }
    //     }

    //     super.notify(propName);
    // }

    destroy(reason) {
        this._inDestruction = true;

        while (this.notifications.length > 0) {
            const [oldest] = this.notifications;
            oldest.destroy(reason);
        }

        this.emit('destroy', reason);

        this.policy.destroy();
        this.run_dispose();
    }

    //// Protected methods ////

    // The subclass must call this at least once to set the summary icon.
    // _setSummaryIcon(icon) {
    //     // global.log("__________");
    //     // global.log("set summary icon");
    //     if (this.icon)
    //         this.icon.destroy();
    //     this.icon = icon;
    //     // global.log(this.icon);
    //     // global.log("__________");
    // }

    // Default implementation is to do nothing, but subclasses can override
    open() {
    }

    destroyNonResidentNotifications() {
        for (let i = this.notifications.length - 1; i >= 0; i--)
            if (!this.notifications[i].resident)
                this.notifications[i].destroy();
    }

    // Default implementation is to destroy this source, but subclasses can override
    // _lastNotificationRemoved() {
    //     this.destroy();
    // }
});
// Signals.addSignalMethods(Source.prototype);

GObject.registerClass({
    Properties: {
        'source': GObject.ParamSpec.object(
            'source', 'source', 'source',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY,
            Source),
        'title': GObject.ParamSpec.string(
            'title', 'title', 'title',
            GObject.ParamFlags.READWRITE,
            null),
        'body': GObject.ParamSpec.string(
            'body', 'body', 'body',
            GObject.ParamFlags.READWRITE,
            null),
        'use-body-markup': GObject.ParamSpec.boolean(
            'use-body-markup', 'use-body-markup', 'use-body-markup',
            GObject.ParamFlags.READWRITE,
            false),
        'gicon': GObject.ParamSpec.object(
            'gicon', 'gicon', 'gicon',
            GObject.ParamFlags.READWRITE,
            Gio.Icon),
        'icon-name': GObject.ParamSpec.string(
            'icon-name', 'icon-name', 'icon-name',
            GObject.ParamFlags.READWRITE,
            null),
        // 'sound': GObject.ParamSpec.object(
        //     'sound', 'sound', 'sound',
        //     GObject.ParamFlags.READWRITE,
        //     Sound),
        'datetime': GObject.ParamSpec.boxed(
            'datetime', 'datetime', 'datetime',
            GObject.ParamFlags.READWRITE,
            GLib.DateTime),
        // Unfortunately we can't register new enum types in GJS
        // See: https://gitlab.gnome.org/GNOME/gjs/-/issues/573
        'privacy-scope': GObject.ParamSpec.int(
            'privacy-scope', 'privacy-scope', 'privacy-scope',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
            0, GLib.MAXINT32,
            PrivacyScope.User),
        'urgency': GObject.ParamSpec.int(
            'urgency', 'urgency', 'urgency',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
            0, GLib.MAXINT32,
            Urgency.NORMAL),
        'acknowledged': GObject.ParamSpec.boolean(
            'acknowledged', 'acknowledged', 'acknowledged',
            GObject.ParamFlags.READWRITE,
            false),
        'resident': GObject.ParamSpec.boolean(
            'resident', 'resident', 'resident',
            GObject.ParamFlags.READWRITE,
            false),
        'for-feedback': GObject.ParamSpec.boolean(
            'for-feedback', 'for-feedback', 'for-feedback',
            GObject.ParamFlags.READWRITE,
            false),
        'is-transient': GObject.ParamSpec.boolean(
            'is-transient', 'is-transient', 'is-transient',
            GObject.ParamFlags.READWRITE,
            false),
    },
    Signals: {
        'action-added': {param_types: [Action]},
        'action-removed': {param_types: [Action]},
        'activated': {},
        'destroy': {param_types: [GObject.TYPE_UINT]},
    },
}, Notification);

// function MessageTray() {
//     this._init();
// }

// MessageTray.prototype = {
var MessageTray = GObject.registerClass({
    Signals: {
        'queue-changed': {},
        'source-added': {param_types: [Source.$gtype]},
        'source-removed': {param_types: [Source.$gtype]},
    },
}, class MessageTray extends St.Widget {
    _init() {
        super._init({
            visible: false,
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
        });

        this._presence = new GnomeSession.Presence((proxy, error) => {
            this._onStatusChanged(proxy.status);
        });

        this._userStatus = GnomeSession.PresenceStatus.AVAILABLE;
        this._busy = false;
        // this._backFromAway = false;
        this._bannerBlocked = false;

        this._presence.connectSignal('StatusChanged', (proxy, senderName, [status]) => {
            this._onStatusChanged(status);
        });

        let constraint = new Layout.MonitorConstraint({ primary: true });
        this.add_constraint(constraint);

        this._bannerBin = new St.Widget({
            name: 'notification-container',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.START,
            x_align: Clutter.ActorAlign.END,
            y_expand: true,
            x_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._bannerBin.connect('key-release-event',
            this._onNotificationKeyRelease.bind(this));
        this._bannerBin.connect('notify::hover',
            this._onNotificationHoverChanged.bind(this));
        this.add_child(this._bannerBin);

        // this._notificationBin = new St.Bin();
        // this._notificationBin.hide();
        // this._notificationQueue = [];
        // this._notification = null;

        this._notificationFocusGrabber = new FocusGrabber(this._bannerBin);
        this._notificationQueue = [];
        this._notification = null;
        this._banner = null;

        this._userActiveWhileNotificationShown = false;

        this.idleMonitor = Meta.IdleMonitor.get_core();

        this._useLongerNotificationLeftTimeout = false;

        this._locked = false;
        // this._notificationState = State.HIDDEN;
        // this._notificationTimeoutId = 0;
        // this._notificationExpandedId = 0;
        // this._notificationRemoved = false;

        this._pointerInNotification = false;

        this._notificationHovered = false;

        this._notificationState = State.HIDDEN;
        this._notificationTimeoutId = 0;
        this._notificationRemoved = false;

        Main.layoutManager.addChrome(this, { affectsInputRegion: false });
        Main.layoutManager.trackChrome(this._bannerBin, { affectsInputRegion: true });

        this._sources = new Set();

        // this._sources = [];
        // Main.layoutManager.addChrome(this._notificationBin);

        // Settings
        // this.settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.notifications" });
        // function setting(self, source, camelCase, dashed) {
        //     function updater() { self[camelCase] = source.get_boolean(dashed); }
        //     source.connect('changed::' + dashed, updater);
        //     updater();
        // }
        // setting(this, this.settings, "_notificationsEnabled", "display-notifications");
        // this.bottomPosition = this.settings.get_boolean("bottom-notifications");
        // this.settings.connect("changed::bottom-notifications", () => {
        //     this.bottomPosition = this.settings.get_boolean("bottom-notifications");
        // });

        let updateLockState = () => {
            if (this._locked) {
                this._unlock();
            } else {
                this._updateState();
            }
        };

        Main.overview.connect('showing', updateLockState);
        Main.overview.connect('hiding', updateLockState);
        Main.expo.connect('showing', updateLockState);
        Main.expo.connect('hiding', updateLockState);

        this._updateState();
    }

    get bannerAlignment() {
        return this._bannerBin.get_x_align();
    }

    set bannerAlignment(align) {
        this._bannerBin.set_x_align(align);
    }

    _onNotificationKeyRelease(actor, event) {
        if (event.get_key_symbol() === Clutter.KEY_Escape && event.get_state() === 0) {
            this._expireNotification();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _expireNotification() {
        this._notificationExpired = true;
        this._updateState();
    }

    get queueCount() {
        return this._notificationQueue.length;
    }

    set bannerBlocked(v) {
        if (this._bannerBlocked === v)
            return;
        this._bannerBlocked = v;
        this._updateState();
    }

    contains(source) {
        return this._sources.has(source);
    }

    // _getSourceIndex(source) {
    //     return this._sources.indexOf(source);
    // }

    add(source) {
        if (this.contains(source)) {
            log(`Trying to re-add source ${source.title}`);
            return;
        }

        source.policy.store();

        source.policy.connect('notify::enable', () => {
            this._onSourceEnableChanged(source.policy, source);
        });
        source.policy.connect('notify', this._updateState.bind(this));

        // source.connect('notification-show', this._onNotify.bind(this));

        // source.connect('destroy', this._onSourceDestroy.bind(this));
        this._onSourceEnableChanged(source.policy, source);
    }

    _addSource(source) {
        this._sources.add(source);

        source.connectObject(
            'notification-request-banner', this._onNotificationRequestBanner.bind(this),
            'notification-removed', this._onNotificationRemoved.bind(this),
            'destroy', () => this._removeSource(source), this);

        this.emit('source-added', source);
    }

    _removeSource(source) {
        this._sources.delete(source);
        source.disconnectObject(this);
        this.emit('source-removed', source);
    }

    getSources() {
        return [...this._sources.keys()];
    }

    _onSourceEnableChanged(policy, source) {
        let wasEnabled = this.contains(source);
        let shouldBeEnabled = policy.enable;

        if (wasEnabled !== shouldBeEnabled) {
            if (shouldBeEnabled)
                this._addSource(source);
            else
                this._removeSource(source);
        }
    }

    _onNotificationRemoved(source, notification) {
        if (this._notification === notification) {
            this._notificationRemoved = true;
            if (this._notificationState === State.SHOWN ||
                this._notificationState === State.SHOWING) {
                this._pointerInNotification = false;
                this._updateNotificationTimeout(0);
                this._updateState();
            }
        } else {
            const index = this._notificationQueue.indexOf(notification);
            if (index !== -1) {
                this._notificationQueue.splice(index, 1);
                this.emit('queue-changed');
            }
        }
    }

    _onNotificationRequestBanner(_source, notification) {
        // We never display a banner for already acknowledged notifications
        if (notification.acknowledged)
            return;

        if (notification.urgency === Urgency.LOW)
            return;

        if (!notification.source.policy.showBanners && notification.urgency !== Urgency.CRITICAL)
            return;

        if (this._notification === notification) {
            // If a notification that is being shown is updated, we update
            // how it is shown and extend the time until it auto-hides.
            // If a new notification is updated while it is being hidden,
            // we stop hiding it and show it again.
            this._updateShowingNotification();
        } else if (!this._notificationQueue.includes(notification)) {
            // If the queue is "full", we skip banner mode and just show a small
            // indicator in the panel; however do make an exception for CRITICAL
            // notifications, as only banner mode allows expansion.
            let bannerCount = this._notification ? 1 : 0;
            let full = this.queueCount + bannerCount >= MAX_NOTIFICATIONS_IN_QUEUE;
            if (!full || notification.urgency === Urgency.CRITICAL) {
                this._notificationQueue.push(notification);
                this._notificationQueue.sort(
                    (n1, n2) => n2.urgency - n1.urgency);
                this.emit('queue-changed');
            }
        }
        this._updateState();
    }

    _resetNotificationLeftTimeout() {
        this._useLongerNotificationLeftTimeout = false;
        if (this._notificationLeftTimeoutId) {
            GLib.source_remove(this._notificationLeftTimeoutId);
            this._notificationLeftTimeoutId = 0;
            this._notificationLeftMouseX = -1;
            this._notificationLeftMouseY = -1;
        }
    }

    _onNotificationHoverChanged() {
        if (this._bannerBin.hover === this._notificationHovered)
            return;

        this._notificationHovered = this._bannerBin.hover;
        if (this._notificationHovered) {
            this._resetNotificationLeftTimeout();

            if (this._showNotificationMouseX >= 0) {
                let actorAtShowNotificationPosition =
                    global.stage.get_actor_at_pos(Clutter.PickMode.ALL, this._showNotificationMouseX, this._showNotificationMouseY);
                this._showNotificationMouseX = -1;
                this._showNotificationMouseY = -1;
                // Don't set this._pointerInNotification to true if the pointer was initially in the area where the notification
                // popped up. That way we will not be expanding notifications that happen to pop up over the pointer
                // automatically. Instead, the user is able to expand the notification by mousing away from it and then
                // mousing back in. Because this is an expected action, we set the boolean flag that indicates that a longer
                // timeout should be used before popping down the notification.
                if (this._bannerBin.contains(actorAtShowNotificationPosition)) {
                    this._useLongerNotificationLeftTimeout = true;
                    return;
                }
            }

            this._pointerInNotification = true;
            this._updateState();
        } else {
            // We record the position of the mouse the moment it leaves the tray. These coordinates are used in
            // this._onNotificationLeftTimeout() to determine if the mouse has moved far enough during the initial timeout for us
            // to consider that the user intended to leave the tray and therefore hide the tray. If the mouse is still
            // close to its previous position, we extend the timeout once.
            let [x, y] = global.get_pointer();
            this._notificationLeftMouseX = x;
            this._notificationLeftMouseY = y;

            // We wait just a little before hiding the message tray in case the user quickly moves the mouse back into it.
            // We wait for a longer period if the notification popped up where the mouse pointer was already positioned.
            // That gives the user more time to mouse away from the notification and mouse back in in order to expand it.
            let timeout = this._useLongerNotificationLeftTimeout ? LONGER_HIDE_TIMEOUT : HIDE_TIMEOUT;
            this._notificationLeftTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, this._onNotificationLeftTimeout.bind(this));
            GLib.Source.set_name_by_id(this._notificationLeftTimeoutId, '[cinnamon] this._onNotificationLeftTimeout');
        }
    }

    _onStatusChanged(status) {
        if (status === GnomeSession.PresenceStatus.BUSY) {
            // remove notification and allow the summary to be closed now
            this._updateNotificationTimeout(0);
            this._busy = true;
        } else if (status !== GnomeSession.PresenceStatus.IDLE) {
            // We preserve the previous value of this._busy if the status turns to IDLE
            // so that we don't start showing notifications queued during the BUSY state
            // as the screensaver gets activated.
            this._busy = false;
        }

        this._updateState();
    }

    _onNotificationLeftTimeout() {
        let [x, y] = global.get_pointer();
        // We extend the timeout once if the mouse moved no further than MOUSE_LEFT_ACTOR_THRESHOLD to either side.
        if (this._notificationLeftMouseX > -1 &&
            y < this._notificationLeftMouseY + MOUSE_LEFT_ACTOR_THRESHOLD &&
            y > this._notificationLeftMouseY - MOUSE_LEFT_ACTOR_THRESHOLD &&
            x < this._notificationLeftMouseX + MOUSE_LEFT_ACTOR_THRESHOLD &&
            x > this._notificationLeftMouseX - MOUSE_LEFT_ACTOR_THRESHOLD) {
            this._notificationLeftMouseX = -1;
            this._notificationLeftTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                LONGER_HIDE_TIMEOUT,
                this._onNotificationLeftTimeout.bind(this));
            GLib.Source.set_name_by_id(this._notificationLeftTimeoutId, '[cinnamon] this._onNotificationLeftTimeout');
        } else {
            this._notificationLeftTimeoutId = 0;
            this._useLongerNotificationLeftTimeout = false;
            this._pointerInNotification = false;
            this._updateNotificationTimeout(0);
            this._updateState();
        }
        return GLib.SOURCE_REMOVE;
    }

    _updateState() {
        let hasMonitor = Main.layoutManager.primaryMonitor != null;
        this.visible = !this._bannerBlocked && hasMonitor && this._banner != null;
        if (this._bannerBlocked || !hasMonitor)
            return;

        // If our state changes caused _updateState to be called,
        // just exit now to prevent reentrancy issues.
        if (this._updatingState)
            return;

        this._updatingState = true;

        // Filter out acknowledged notifications.
        let changed = false;
        this._notificationQueue = this._notificationQueue.filter(n => {
            changed ||= n.acknowledged;
            return !n.acknowledged;
        });

        if (changed)
            this.emit('queue-changed');

        let hasNotifications = true;

        if (this._notificationState === State.HIDDEN) {
            let nextNotification = this._notificationQueue[0] || null;
            if (hasNotifications && nextNotification) {
                let limited = this._busy || Main.layoutManager.primaryMonitor.inFullscreen;
                let showNextNotification = !limited || nextNotification.forFeedback || nextNotification.urgency === Urgency.CRITICAL;
                if (showNextNotification)
                    this._showNotification();
            }
        } else if (this._notificationState === State.SHOWING ||
                   this._notificationState === State.SHOWN) {
            let expired = (this._userActiveWhileNotificationShown &&
                           this._notificationTimeoutId === 0 &&
                           this._notification.urgency !== Urgency.CRITICAL &&
                           !this._pointerInNotification) || this._notificationExpired;
            let mustClose = this._notificationRemoved || !hasNotifications || expired;

            if (mustClose) {
                let animate = hasNotifications && !this._notificationRemoved;
                this._hideNotification(animate);
            } else if (this._notificationState === State.SHOWN &&
                       this._pointerInNotification) {
                if (!this._banner.expanded)
                    this._expandBanner(false);
                else
                    this._ensureBannerFocused();
            }
        }

        this._updatingState = false;

        // Clean transient variables that are used to communicate actions
        // to updateState()
        this._notificationExpired = false;
    }

    _onIdleMonitorBecameActive() {
        this._userActiveWhileNotificationShown = true;
        this._updateNotificationTimeout(2000);
        this._updateState();
    }

    _showNotification() {
        this._notification = this._notificationQueue.shift();
        this.emit('queue-changed');

        this._userActiveWhileNotificationShown = this.idleMonitor.get_idletime() <= IDLE_TIME;
        if (!this._userActiveWhileNotificationShown) {
            // If the user isn't active, set up a watch to let us know
            // when the user becomes active.
            this.idleMonitor.add_user_active_watch(this._onIdleMonitorBecameActive.bind(this));
        }

        this._banner = new NotificationMessage(this._notification);
        this._banner.can_focus = false;
        this._banner._header.expandButton.visible = false;
        this._banner.add_style_class_name('notification-banner');

        this._bannerBin.add_child(this._banner);

        this._bannerBin.opacity = 0;
        this._bannerBin.y = -this._banner.height;
        this.show();

        Meta.disable_unredirect_for_display(global.display);
        this._updateShowingNotification();

        let [x, y] = global.get_pointer();
        // We save the position of the mouse at the time when we started showing the notification
        // in order to determine if the notification popped up under it. We make that check if
        // the user starts moving the mouse and _onNotificationHoverChanged() gets called. We don't
        // expand the notification if it just happened to pop up under the mouse unless the user
        // explicitly mouses away from it and then mouses back in.
        this._showNotificationMouseX = x;
        this._showNotificationMouseY = y;
        // We save the coordinates of the mouse at the time when we started showing the notification
        // and then we update it in _notificationTimeout(). We don't pop down the notification if
        // the mouse is moving towards it or within it.
        this._lastSeenMouseX = x;
        this._lastSeenMouseY = y;

        this._resetNotificationLeftTimeout();
    }

    _updateShowingNotification() {
        this._notification.acknowledged = true;
        // this._notification.playSound();

        // We auto-expand notifications with CRITICAL urgency, or for which the relevant setting
        // is on in the control center.
        if (this._notification.urgency === Urgency.CRITICAL ||
            this._notification.source.policy.forceExpanded)
            this._expandBanner(true);

        // We tween all notifications to full opacity. This ensures that both new notifications and
        // notifications that might have been in the process of hiding get full opacity.
        //
        // We tween any notification showing in the banner mode to the appropriate height
        // (which is banner height or expanded height, depending on the notification state)
        // This ensures that both new notifications and notifications in the banner mode that might
        // have been in the process of hiding are shown with the correct height.
        //
        // We use this._showNotificationCompleted() onComplete callback to extend the time the updated
        // notification is being shown.

        this._notificationState = State.SHOWING;
        this._bannerBin.remove_all_transitions();
        this._bannerBin.ease({
            opacity: 255,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.LINEAR,
        });
        this._bannerBin.ease({
            y: 0,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onComplete: () => {
                this._notificationState = State.SHOWN;
                this._showNotificationCompleted();
                this._updateState();
            },
        });
    }

    _showNotificationCompleted() {
        if (this._notification.urgency !== Urgency.CRITICAL)
            this._updateNotificationTimeout(NOTIFICATION_TIMEOUT);
    }

    _updateNotificationTimeout(timeout) {
        if (this._notificationTimeoutId) {
            GLib.source_remove(this._notificationTimeoutId);
            this._notificationTimeoutId = 0;
        }
        if (timeout > 0) {
            this._notificationTimeoutId =
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout,
                    this._notificationTimeout.bind(this));
            GLib.Source.set_name_by_id(this._notificationTimeoutId, '[cinnamon] this._notificationTimeout');
        }
    }

    _notificationTimeout() {
        let [x, y] = global.get_pointer();
        if (y < this._lastSeenMouseY - 10 && !this._notificationHovered) {
            // The mouse is moving towards the notification, so don't
            // hide it yet. (We just create a new timeout (and destroy
            // the old one) each time because the bookkeeping is
            // simpler.)
            this._updateNotificationTimeout(1000);
        } else if (this._useLongerNotificationLeftTimeout && !this._notificationLeftTimeoutId &&
                  (x !== this._lastSeenMouseX || y !== this._lastSeenMouseY)) {
            // Refresh the timeout if the notification originally
            // popped up under the pointer, and the pointer is hovering
            // inside it.
            this._updateNotificationTimeout(1000);
        } else {
            this._notificationTimeoutId = 0;
            this._updateState();
        }

        this._lastSeenMouseX = x;
        this._lastSeenMouseY = y;
        return GLib.SOURCE_REMOVE;
    }

    _hideNotification(animate) {
        this._notificationFocusGrabber.ungrabFocus();

        this._banner.disconnectObject(this);

        this._resetNotificationLeftTimeout();
        this._bannerBin.remove_all_transitions();

        const duration = animate ? ANIMATION_TIME : 0;
        this._notificationState = State.HIDING;
        this._bannerBin.ease({
            opacity: 0,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
        this._bannerBin.ease({
            y: -this._bannerBin.height,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onComplete: () => {
                this._notificationState = State.HIDDEN;
                this._hideNotificationCompleted();
                this._updateState();
            },
        });
    }

    _hideNotificationCompleted() {
        let notification = this._notification;
        this._notification = null;
        if (!this._notificationRemoved && notification.isTransient)
            notification.destroy(NotificationDestroyedReason.EXPIRED);

        this._pointerInNotification = false;
        this._notificationRemoved = false;
        Meta.enable_unredirect_for_display(global.display);

        this._banner.destroy();
        this._banner = null;
        this.hide();
    }

    _expandActiveNotification() {
        if (!this._banner)
            return;

        this._expandBanner(false);
    }

    _expandBanner(autoExpanding) {
        // Don't animate changes in notifications that are auto-expanding.
        this._banner.expand(!autoExpanding);

        // Don't focus notifications that are auto-expanding.
        if (!autoExpanding)
            this._ensureBannerFocused();
    }

    _ensureBannerFocused() {
        this._notificationFocusGrabber.grabFocus();
    }

    _lock() {
        this._locked = true;
    }

    _unlock() {
        if (!this._locked)
            return;
        this._locked = false;
        this._updateState();
    }

});

let systemNotificationSource = null;
// Signals.addSignalMethods(MessageTray.prototype);

// var SystemNotificationSource = class SystemNotificationSource extends Source {
//     constructor() {
//         super();
        // Source.prototype._init.call(this, _("System Information"));
// var SystemNotificationSource = GObject.registerClass(
// class SystemNotificationSource extends Source {
//     constructor() {
//         super({
//             title: _('System Information'),
//             iconName: 'dialog-information-symbolic',
//         });
//     }

//     open() {
//         this.destroy();
//     }
// });

function getSystemSource() {
    if (!systemNotificationSource) {
        systemNotificationSource = new Source({
            title: _('System'),
            iconName: 'emblem-system-symbolic',
        });

        systemNotificationSource.connect('destroy', () => {
            systemNotificationSource = null;
        });
        Main.messageTray.add(systemNotificationSource);
    }

    return systemNotificationSource;
}
