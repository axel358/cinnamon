// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;

const Lightbox = imports.ui.lightbox;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;

const FLASHSPOT_ANIMATION_TIME = 0.4; // seconds

var Flashspot = class Flashspot extends Lightbox.Lightbox {
    constructor(area) {
        super(
            Main.uiGroup,
            {
                inhibitEvents: true,
                width: area.width,
                height: area.height
            }
        );

        this.style_class = 'flashspot';
        this.set_position(area.x, area.y);
        if (area.time)
            this.animation_time = area.time;
        else
            this.animation_time = FLASHSPOT_ANIMATION_TIME;
   }

   fire() {
      this.opacity = 255;
      Tweener.addTween(this,
                      { opacity: 0,
                        time: this.animation_time,
                        transition: 'easeOutQuad',
                        onComplete: Lang.bind(this, this._onFireShowComplete)
                      });
      this.show();
   }

   _onFireShowComplete () {
        this.destroy();
   }
};

