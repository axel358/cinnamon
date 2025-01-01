#!/usr/bin/python3

import gi
gi.require_version('Notify', '0.7')
from gi.repository import Gio, Notify

from SettingsWidgets import SidePage
from xapp.GSettingsWidgets import *

content = """
Lorem ipsum dolor sit amet, consectetur adipiscing elit. \
Suspendisse eleifend, lacus ut tempor vehicula, lorem tortor \
suscipit libero, sit amet congue odio libero vitae lacus. \
Sed est nibh, lacinia ac magna non, blandit aliquet est. \
Mauris volutpat est vel lacinia faucibus. Pellentesque \
pulvinar eros at dolor pretium, eget hendrerit leo rhoncus. \
Sed nisl leo, posuere eget risus vel, euismod egestas metus. \
Praesent interdum, dui sit amet convallis rutrum, velit nunc \
sollicitudin erat, ac viverra leo eros in nulla. Morbi feugiat \
feugiat est. Nam non libero dolor. Duis egestas sodales massa \
sit amet lobortis. Donec sit amet nisi turpis. Morbi aliquet \
aliquam ullamcorper.
"""

NOTIFICATION_DISPLAY_SCREENS = [
    ("primary-screen", _("Primary monitor")),
    ("active-screen", _("Active monitor")),
    ("fixed-screen", _("The monitor specified below"))
]

MASTER_SCHEMA = "org.cinnamon.desktop.notifications"
APP_SCHEMA = "org.cinnamon.desktop.notifications.application"
APP_PREFIX = "/org/cinnamon/desktop/notifications/application/"


class Module:
    name = "notifications"
    comment = _("Notification preferences")
    category = "prefs"

    def __init__(self, content_box):
        keywords = _("notifications")
        sidePage = SidePage(_("Notifications"), "cs-notifications", keywords, content_box, module=self)
        self.sidePage = sidePage

    def on_module_selected(self):
        if self.loaded:
            return

        print("Loading Notifications module")

        Notify.init("cinnamon-settings")

        self.sidePage.stack = SettingsStack()
        self.sidePage.add_widget(self.sidePage.stack)

        # Settings
        page = SettingsPage()
        self.sidePage.stack.add_titled(page, "settings", _("Settings"))

        settings = page.add_section(_("Notification settings"))

        switch = GSettingsSwitch(_("Enable notifications"), "org.cinnamon.desktop.notifications", "display-notifications")
        settings.add_row(switch)

        switch = GSettingsSwitch(_("Remove notifications after their timeout is reached"), "org.cinnamon.desktop.notifications", "remove-old")
        settings.add_reveal_row(switch, "org.cinnamon.desktop.notifications", "display-notifications")

        switch = GSettingsSwitch(_("Show notifications on the bottom side of the screen"), "org.cinnamon.desktop.notifications", "bottom-notifications")
        settings.add_reveal_row(switch, "org.cinnamon.desktop.notifications", "display-notifications")

        combo = GSettingsComboBox(_("Monitor to use for displaying notifications"), "org.cinnamon.desktop.notifications", "notification-screen-display", NOTIFICATION_DISPLAY_SCREENS)
        settings.add_reveal_row(combo, "org.cinnamon.desktop.notifications", "display-notifications")

        spin = GSettingsSpinButton(_("Monitor"), "org.cinnamon.desktop.notifications", "notification-fixed-screen", None, 1, 13, 1)
        settings.add_reveal_row(spin)
        spin.revealer.settings = Gio.Settings("org.cinnamon.desktop.notifications")
        spin.revealer.settings.bind_with_mapping("notification-screen-display", spin.revealer, "reveal-child", Gio.SettingsBindFlags.GET, lambda option: option == "fixed-screen", None)

        switch = GSettingsSwitch(_("Display notifications over fullscreen windows"), "org.cinnamon.desktop.notifications", "fullscreen-notifications")
        settings.add_reveal_row(switch, "org.cinnamon.desktop.notifications", "display-notifications")

        spin = GSettingsSpinButton(_("Notification duration"), "org.cinnamon.desktop.notifications", "notification-duration", _("seconds"), 1, 60, 1, 1)
        settings.add_reveal_row(spin, "org.cinnamon.desktop.notifications", "display-notifications")

        button = Button(_("Display a test notification"), self.send_test)
        settings.add_reveal_row(button, "org.cinnamon.desktop.notifications", "display-notifications")

        settings = page.add_section(_("Media keys OSD"))

        switch = GSettingsSwitch(_("Show media keys OSD"), "org.cinnamon", "show-media-keys-osd")
        settings.add_row(switch)

        # Apps
        page = SettingsPage()
        self.sidePage.stack.add_titled(page, "apps", _("Apps"))

        self.list_box = Gtk.ListBox()
        page.pack_start(self.list_box, False, False, 0)

        # self.app_settings = page.add_section(_("Apps"))
        self.list_box.connect("row-activated", self.on_row_selected)

        self.master_settings = Gio.Settings(MASTER_SCHEMA)
        self.all_apps = {}
        self.build_app_list()

    def on_row_selected(self, listbox, row):
        print("Row is selected")
        dialog = NotificationDialog(row.app_id, row.app_info.get_name(), row.settings, self.master_settings)
        dialog.set_transient_for(row.get_toplevel())
        dialog.run()

    def add_application(self, notif_app):
        # app_name = notif_app.app_info.get_name()
        # print(app_name)

        # icon = notif_app.app_info.get_icon()

        row = AppRow(notif_app)
        row.set_activatable(True)

        # self.app_settings.add_row(row)
        self.list_box.add(row)

        # notif_app.settings.bind("enable", row, )

    def maybe_add_app(self, app):
        path = APP_PREFIX + app + "/"
        settings = Gio.Settings.new_with_path(APP_SCHEMA, path)

        full_app_id = settings.get_string("application-id")
        app_info = Gio.DesktopAppInfo.new(full_app_id)

        if app_info is None:
            return

        notif_app = NotifApp(full_app_id, settings, app_info)

        self.add_application(notif_app)

    def process_app_info(self, app_info):
        app_id = app_info.get_id()

        path = APP_PREFIX + app_id + "/"
        settings = Gio.Settings.new_with_path(APP_SCHEMA, path)

        notif_app = NotifApp(app_id, settings, app_info)

        self.add_application(notif_app)

    def load_apps(self):
        app_infos = Gio.AppInfo.get_all()

        for app_info in app_infos:
            if app_info.get_boolean("X-GNOME-UsesNotifications"):
                self.process_app_info(app_info)

    def children_changed(self):
        children = self.master_settings.get_strv("application-children")
        for child in children:
            self.maybe_add_app(child)

    def build_app_list(self):
        self.children_changed()
        self.master_settings.connect("changed::application-children", self.children_changed)

        self.load_apps()

    def send_test(self, widget):
        n = Notify.Notification.new("This is a test notification", content, "dialog-warning")
        n.show()

class AppRow(Gtk.ListBoxRow):
    def __init__(self, notif_app):
        Gtk.ListBoxRow.__init__(self)
        # self.app_name = app_name
        self.app = notif_app
        self.app_id = notif_app.app_id
        self.settings = notif_app.settings
        self.app_info = notif_app.app_info

        app_name = notif_app.app_info.get_name()

        app_icon = notif_app.app_info.get_icon()

        widget = SettingsWidget()
        icon = Gtk.Image.new_from_gicon(app_icon, Gtk.IconSize.LARGE_TOOLBAR)
        widget.pack_start(icon, False, False, 0)

        label = Gtk.Label(app_name)
        widget.pack_start(label, False, False, 0)

        arrow = Gtk.Image.new_from_icon_name("go-next-symbolic", Gtk.IconSize.SMALL_TOOLBAR)
        widget.pack_end(arrow, False, False, 0)

        enabled = Gtk.Label(_("On"))
        widget.pack_end(enabled, False, False, 0)

        self.add(widget)

class NotifApp:
    def __init__(self, app_id, settings, app_info):
        self.app_id = app_id
        self.settings = settings
        self.app_info = app_info

class NotificationDialog(Gtk.Dialog):
    def __init__(self, app_id, title, settings, master_settings):
        Gtk.Dialog.__init__(self)
        self.set_modal(True)
        self.set_default_size(500, 0)
        self.add_button(_("Close"), Gtk.ResponseType.CANCEL)
        self.set_title(title)

        self.settings = settings
        self.master_settings = master_settings
        self.app_id = app_id

        content_area = self.get_content_area()

        page = SettingsPage()
        content_area.add(page)
        settings = page.add_section(_("Notification settings"))

        # enabled = self.settings.set_boolean("enable", True)
        switch = Switch(_("Enable notifications"))
        settings.add_row(switch)

        self.show_all()
