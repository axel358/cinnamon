
const { Clutter, CDesktopEnums, Gio, GLib, GObject, CinnamonDesktop, Meta } = imports.gi;
const Signals = imports.signals;

const Main = imports.ui.main;
const Params = imports.misc.params;

var DEFAULT_BACKGROUND_COLOR = Clutter.Color.from_pixel(0x2e3436ff);

const BACKGROUND_SCHEMA = 'org.cinnamon.desktop.background';
const PRIMARY_COLOR_KEY = 'primary-color';
const SECONDARY_COLOR_KEY = 'secondary-color';
const COLOR_SHADING_TYPE_KEY = 'color-shading-type';
const BACKGROUND_STYLE_KEY = 'picture-options';
const PICTURE_URI_KEY = 'picture-uri';

var FADE_ANIMATION_TIME = 1000;

// These parameters affect how often we redraw.
// The first is how different (percent crossfaded) the slide show
// has to look before redrawing and the second is the minimum
// frequency (in seconds) we're willing to wake up
var ANIMATION_OPACITY_STEP_INCREMENT = 4.0;
var ANIMATION_MIN_WAKEUP_INTERVAL = 1.0;

let _backgroundCache = null;

function _fileEqual0(file1, file2) {
    if (file1 == file2)
        return true;

    if (!file1 || !file2)
        return false;

    return file1.equal(file2);
}

var BackgroundCache = class BackgroundCache {
    constructor() {
        this._fileMonitors = {};
        this._backgroundSources = {};
        this._animations = {};
    }

    monitorFile(file) {
        let key = file.hash();
        if (this._fileMonitors[key])
            return;

        let monitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
        monitor.connect('changed',
                        (obj, theFile, otherFile, eventType) => {
                            // Ignore CHANGED and CREATED events, since in both cases
                            // we'll get a CHANGES_DONE_HINT event when done.
                            if (eventType != Gio.FileMonitorEvent.CHANGED &&
                                eventType != Gio.FileMonitorEvent.CREATED)
                                this.emit('file-changed', file);
                        });

        this._fileMonitors[key] = monitor;
    }

    // getAnimation(params) {
    //     params = Params.parse(params, { file: null,
    //                                     settingsSchema: null,
    //                                     onLoaded: null });

    //     let animation = this._animations[params.settingsSchema];
    //     if (animation && _fileEqual0(animation.file, params.file)) {
    //         if (params.onLoaded) {
    //             let id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    //                 params.onLoaded(this._animations[params.settingsSchema]);
    //                 return GLib.SOURCE_REMOVE;
    //             });
    //             GLib.Source.set_name_by_id(id, '[cinnamon] params.onLoaded');
    //         }
    //         return;
    //     }

    //     animation = new Animation({ file: params.file });

    //     animation.load(() => {
    //         this._animations[params.settingsSchema] = animation;

    //         if (params.onLoaded) {
    //             let id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    //                 params.onLoaded(this._animations[params.settingsSchema]);
    //                 return GLib.SOURCE_REMOVE;
    //             });
    //             GLib.Source.set_name_by_id(id, '[cinnamon] params.onLoaded');
    //         }
    //     });
    // }

    getBackgroundSource(layoutManager, settingsSchema) {
        // The layoutManager is always the same one; we pass in it since
        // Main.layoutManager may not be set yet

        if (!(settingsSchema in this._backgroundSources)) {
            this._backgroundSources[settingsSchema] = new BackgroundSource(layoutManager, settingsSchema);
            this._backgroundSources[settingsSchema]._useCount = 1;
        } else {
            this._backgroundSources[settingsSchema]._useCount++;
        }

        return this._backgroundSources[settingsSchema];
    }

    releaseBackgroundSource(settingsSchema) {
        if (settingsSchema in this._backgroundSources) {
            let source = this._backgroundSources[settingsSchema];
            source._useCount--;
            if (source._useCount == 0) {
                delete this._backgroundSources[settingsSchema];
                source.destroy();
            }
        }
    }
};
Signals.addSignalMethods(BackgroundCache.prototype);

function getBackgroundCache() {
    if (!_backgroundCache)
        _backgroundCache = new BackgroundCache();
    return _backgroundCache;
}

var Background = GObject.registerClass({
    Signals: { 'loaded': {}, 'bg-changed': {} },
}, class Background extends Meta.Background {
    _init(params) {
        params = Params.parse(params, { monitorIndex: 0,
                                        layoutManager: Main.layoutManager,
                                        settings: null,
                                        file: null,
                                        style: null });

        super._init({ meta_display: global.display });

        this._settings = params.settings;
        this._file = params.file;
        this._style = params.style;
        this._monitorIndex = params.monitorIndex;
        this._layoutManager = params.layoutManager;
        this._fileWatches = {};
        this._cancellable = new Gio.Cancellable();
        this.isLoaded = false;

        this._clock = new CinnamonDesktop.WallClock();
        // this._timezoneChangedId = this._clock.connect('notify::timezone',
        //     () => {
        //         if (this._animation)
        //             this._loadAnimation(this._animation.file);
        //     });

        // let loginManager = LoginManager.getLoginManager();
        // this._prepareForSleepId = loginManager.connect('prepare-for-sleep',
        //     (lm, aboutToSuspend) => {
        //         if (aboutToSuspend)
        //             return;
        //         this._refreshAnimation();
        //     });

        this._settingsChangedSignalId =
            this._settings.connect('changed', this._emitChangedSignal.bind(this));

        this._load();
    }

    destroy() {
        this._cancellable.cancel();
        // this._removeAnimationTimeout();

        let i;
        let keys = Object.keys(this._fileWatches);
        for (i = 0; i < keys.length; i++)
            this._cache.disconnect(this._fileWatches[keys[i]]);

        this._fileWatches = null;

        // if (this._timezoneChangedId != 0)
        //     this._clock.disconnect(this._timezoneChangedId);
        // this._timezoneChangedId = 0;

        this._clock = null;

        // if (this._prepareForSleepId != 0)
        //     LoginManager.getLoginManager().disconnect(this._prepareForSleepId);
        // this._prepareForSleepId = 0;

        if (this._settingsChangedSignalId != 0)
            this._settings.disconnect(this._settingsChangedSignalId);
        this._settingsChangedSignalId = 0;

        if (this._changedIdleId) {
            GLib.source_remove(this._changedIdleId);
            this._changedIdleId = 0;
        }
    }

    _emitChangedSignal() {
        if (this._changedIdleId)
            return;

        this._changedIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._changedIdleId = 0;
            this.emit('bg-changed');
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(this._changedIdleId,
            '[cinnamon] Background._emitChangedSignal');
    }

    updateResolution() {
        // if (this._animation)
        //     this._refreshAnimation();
    }

    // _refreshAnimation() {
    //     if (!this._animation)
    //         return;

    //     this._removeAnimationTimeout();
    //     this._updateAnimation();
    // }

    _setLoaded() {
        if (this.isLoaded)
            return;

        this.isLoaded = true;

        let id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this.emit('loaded');
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(id, '[cinnamon] Background._setLoaded Idle');
    }

    _loadPattern() {
        let colorString, res_, color, secondColor;

        colorString = this._settings.get_string(PRIMARY_COLOR_KEY);
        [res_, color] = Clutter.Color.from_string(colorString);
        colorString = this._settings.get_string(SECONDARY_COLOR_KEY);
        [res_, secondColor] = Clutter.Color.from_string(colorString);

        let shadingType = this._settings.get_enum(COLOR_SHADING_TYPE_KEY);

        if (shadingType == CDesktopEnums.BackgroundShading.SOLID)
            this.set_color(color);
        else
            this.set_gradient(shadingType, color, secondColor);
    }

    _watchFile(file) {
        let key = file.hash();
        if (this._fileWatches[key])
            return;

        this._cache.monitorFile(file);
        let signalId = this._cache.connect('file-changed',
                                           (cache, changedFile) => {
                                               if (changedFile.equal(file)) {
                                                   let imageCache = Meta.BackgroundImageCache.get_default();
                                                   imageCache.purge(changedFile);
                                                   this._emitChangedSignal();
                                               }
                                           });
        this._fileWatches[key] = signalId;
    }

    // _removeAnimationTimeout() {
    //     if (this._updateAnimationTimeoutId) {
    //         GLib.source_remove(this._updateAnimationTimeoutId);
    //         this._updateAnimationTimeoutId = 0;
    //     }
    // }

    // _updateAnimation() {
    //     this._updateAnimationTimeoutId = 0;

    //     this._animation.update(this._layoutManager.monitors[this._monitorIndex]);
    //     let files = this._animation.keyFrameFiles;

    //     let finish = () => {
    //         this._setLoaded();
    //         if (files.length > 1) {
    //             this.set_blend(files[0], files[1],
    //                            this._animation.transitionProgress,
    //                            this._style);
    //         } else if (files.length > 0) {
    //             this.set_file(files[0], this._style);
    //         } else {
    //             this.set_file(null, this._style);
    //         }
    //         this._queueUpdateAnimation();
    //     };

    //     let cache = Meta.BackgroundImageCache.get_default();
    //     let numPendingImages = files.length;
    //     for (let i = 0; i < files.length; i++) {
    //         this._watchFile(files[i]);
    //         let image = cache.load(files[i]);
    //         if (image.is_loaded()) {
    //             numPendingImages--;
    //             if (numPendingImages == 0)
    //                 finish();
    //         } else {
    //             // eslint-disable-next-line no-loop-func
    //             let id = image.connect('loaded', () => {
    //                 image.disconnect(id);
    //                 numPendingImages--;
    //                 if (numPendingImages == 0)
    //                     finish();
    //             });
    //         }
    //     }
    // }

    // _queueUpdateAnimation() {
    //     if (this._updateAnimationTimeoutId != 0)
    //         return;

    //     if (!this._cancellable || this._cancellable.is_cancelled())
    //         return;

    //     if (!this._animation.transitionDuration)
    //         return;

    //     let nSteps = 255 / ANIMATION_OPACITY_STEP_INCREMENT;
    //     let timePerStep = (this._animation.transitionDuration * 1000) / nSteps;

    //     let interval = Math.max(ANIMATION_MIN_WAKEUP_INTERVAL * 1000,
    //                             timePerStep);

    //     if (interval > GLib.MAXUINT32)
    //         return;

    //     this._updateAnimationTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
    //                                                       interval,
    //                                                       () => {
    //                                                           this._updateAnimationTimeoutId = 0;
    //                                                           this._updateAnimation();
    //                                                           return GLib.SOURCE_REMOVE;
    //                                                       });
    //     GLib.Source.set_name_by_id(this._updateAnimationTimeoutId, '[cinnamon] this._updateAnimation');
    // }

    // _loadAnimation(file) {
    //     this._cache.getAnimation({
    //         file,
    //         settingsSchema: this._settings.schema_id,
    //         onLoaded: animation => {
    //             this._animation = animation;

    //             if (!this._animation || this._cancellable.is_cancelled()) {
    //                 this._setLoaded();
    //                 return;
    //             }

    //             this._updateAnimation();
    //             this._watchFile(file);
    //         },
    //     });
    // }

    _loadImage(file) {
        this.set_file(file, this._style);
        this._watchFile(file);

        let cache = Meta.BackgroundImageCache.get_default();
        let image = cache.load(file);
        if (image.is_loaded()) {
            this._setLoaded();
        } else {
            let id = image.connect('loaded', () => {
                this._setLoaded();
                image.disconnect(id);
            });
        }
    }

    _loadFile(file) {
        this._loadImage(file);
        // if (file.get_basename().endsWith('.xml'))
        //     this._loadAnimation(file);
        // else
        //     this._loadImage(file);
    }

    _load() {
        this._cache = getBackgroundCache();

        this._loadPattern();

        if (!this._file) {
            this._setLoaded();
            return;
        }

        this._loadFile(this._file);
    }
});

let _systemBackground;

var SystemBackground = GObject.registerClass({
    Signals: { 'loaded': {} },
}, class SystemBackground extends Meta.BackgroundActor {
    _init() {
        if (_systemBackground == null) {
            _systemBackground = new Meta.Background({ meta_display: global.display });
            _systemBackground.set_color(DEFAULT_BACKGROUND_COLOR);
        }

        super._init({
            meta_display: global.display,
            monitor: 0,
        });
        this.content.background = _systemBackground;

        let id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this.emit('loaded');
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(id, '[cinnamon] SystemBackground.loaded');
    }
});

var BackgroundSource = class BackgroundSource {
    constructor(layoutManager, settingsSchema) {
        // Allow override the background image setting for performance testing
        this._layoutManager = layoutManager;
        this._overrideImage = GLib.getenv('SHELL_BACKGROUND_IMAGE');
        this._settings = new Gio.Settings({ schema_id: settingsSchema });
        this._backgrounds = [];

        let monitorManager = Meta.MonitorManager.get();
        this._monitorsChangedId =
            monitorManager.connect('monitors-changed',
                                   this._onMonitorsChanged.bind(this));
    }

    _onMonitorsChanged() {
        for (let monitorIndex in this._backgrounds) {
            let background = this._backgrounds[monitorIndex];

            if (monitorIndex < this._layoutManager.monitors.length) {
                background.updateResolution();
            } else {
                background.disconnect(background._changedId);
                background.destroy();
                delete this._backgrounds[monitorIndex];
            }
        }
    }

    getBackground(monitorIndex) {
        let file = null;
        let style;

        // We don't watch changes to settings here,
        // instead we rely on Background to watch those
        // and emit 'bg-changed' at the right time

        if (this._overrideImage != null) {
            file = Gio.File.new_for_path(this._overrideImage);
            style = CDesktopEnums.BackgroundStyle.ZOOM; // Hardcode
        } else {
            style = this._settings.get_enum(BACKGROUND_STYLE_KEY);
            if (style != CDesktopEnums.BackgroundStyle.NONE) {
                let uri = this._settings.get_string(PICTURE_URI_KEY);
                file = Gio.File.new_for_commandline_arg(uri);
            }
        }

        // Animated backgrounds are (potentially) per-monitor, since
        // they can have variants that depend on the aspect ratio and
        // size of the monitor; for other backgrounds we can use the
        // same background object for all monitors.
        if (file == null || !file.get_basename().endsWith('.xml'))
            monitorIndex = 0;

        if (!(monitorIndex in this._backgrounds)) {
            let background = new Background({
                monitorIndex,
                layoutManager: this._layoutManager,
                settings: this._settings,
                file,
                style,
            });

            background._changedId = background.connect('bg-changed', () => {
                background.disconnect(background._changedId);
                background.destroy();
                delete this._backgrounds[monitorIndex];
            });

            this._backgrounds[monitorIndex] = background;
        }

        return this._backgrounds[monitorIndex];
    }

    destroy() {
        let monitorManager = Meta.MonitorManager.get();
        monitorManager.disconnect(this._monitorsChangedId);

        for (let monitorIndex in this._backgrounds) {
            let background = this._backgrounds[monitorIndex];
            background.disconnect(background._changedId);
            background.destroy();
        }

        this._backgrounds = null;
    }
};

var BackgroundManager = class BackgroundManager {
    constructor(params) {
        params = Params.parse(params, {
            container: null,
            layoutManager: Main.layoutManager,
            monitorIndex: null,
            vignette: false,
            controlPosition: true,
            settingsSchema: BACKGROUND_SCHEMA,
            useContentSize: true,
        });

        let cache = getBackgroundCache();
        this._settingsSchema = params.settingsSchema;
        this._backgroundSource = cache.getBackgroundSource(params.layoutManager, params.settingsSchema);

        this._container = params.container;
        this._layoutManager = params.layoutManager;
        this._vignette = params.vignette;
        this._monitorIndex = params.monitorIndex;
        this._controlPosition = params.controlPosition;
        this._useContentSize = params.useContentSize;

        this.backgroundActor = this._createBackgroundActor();
        this._newBackgroundActor = null;
    }

    destroy() {
        let cache = getBackgroundCache();
        cache.releaseBackgroundSource(this._settingsSchema);
        this._backgroundSource = null;

        if (this._newBackgroundActor) {
            this._newBackgroundActor.destroy();
            this._newBackgroundActor = null;
        }

        if (this.backgroundActor) {
            this.backgroundActor.destroy();
            this.backgroundActor = null;
        }
    }

    _swapBackgroundActor() {
        let oldBackgroundActor = this.backgroundActor;
        this.backgroundActor = this._newBackgroundActor;
        this._newBackgroundActor = null;
        this.emit('changed');

        oldBackgroundActor.ease({
            opacity: 0,
            duration: FADE_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => oldBackgroundActor.destroy(),
        });
    }

    _updateBackgroundActor() {
        if (this._newBackgroundActor) {
            /* Skip displaying existing background queued for load */
            this._newBackgroundActor.destroy();
            this._newBackgroundActor = null;
        }

        let newBackgroundActor = this._createBackgroundActor();

        const oldContent = this.backgroundActor.content;
        const newContent = newBackgroundActor.content;

        newContent.vignette_sharpness = oldContent.vignette_sharpness;
        newContent.brightness = oldContent.brightness;

        newBackgroundActor.visible = this.backgroundActor.visible;

        this._newBackgroundActor = newBackgroundActor;

        const { background } = newBackgroundActor.content;

        if (background.isLoaded) {
            this._swapBackgroundActor();
        } else {
            newBackgroundActor.loadedSignalId = background.connect('loaded',
                () => {
                    background.disconnect(newBackgroundActor.loadedSignalId);
                    newBackgroundActor.loadedSignalId = 0;

                    this._swapBackgroundActor();
                });
        }
    }

    _createBackgroundActor() {
        let background = this._backgroundSource.getBackground(this._monitorIndex);
        let backgroundActor = new Meta.BackgroundActor({
            meta_display: global.display,
            monitor: this._monitorIndex,
            request_mode: this._useContentSize
                ? Clutter.RequestMode.CONTENT_SIZE
                : Clutter.RequestMode.HEIGHT_FOR_WIDTH,
            x_expand: !this._useContentSize,
            y_expand: !this._useContentSize,
        });
        backgroundActor.content.set({
            background,
            vignette: this._vignette,
            vignette_sharpness: 0.5,
            brightness: 0.5,
        });

        this._container.add_child(backgroundActor);

        if (this._controlPosition) {
            let monitor = this._layoutManager.monitors[this._monitorIndex];
            backgroundActor.set_position(monitor.x, monitor.y);
            this._container.set_child_below_sibling(backgroundActor, null);
        }

        let changeSignalId = background.connect('bg-changed', () => {
            background.disconnect(changeSignalId);
            changeSignalId = null;
            this._updateBackgroundActor();
        });

        let loadedSignalId;
        if (background.isLoaded) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this.emit('loaded');
                return GLib.SOURCE_REMOVE;
            });
        } else {
            loadedSignalId = background.connect('loaded', () => {
                background.disconnect(loadedSignalId);
                loadedSignalId = null;
                this.emit('loaded');
            });
        }

        backgroundActor.connect('destroy', () => {
            if (changeSignalId)
                background.disconnect(changeSignalId);

            if (loadedSignalId)
                background.disconnect(loadedSignalId);

            if (backgroundActor.loadedSignalId)
                background.disconnect(backgroundActor.loadedSignalId);
        });

        return backgroundActor;
    }
};
Signals.addSignalMethods(BackgroundManager.prototype);

