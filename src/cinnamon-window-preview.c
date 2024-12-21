#include "config.h"

#include "cinnamon-window-preview.h"

struct _CinnamonWindowPreviewPrivate
{
  ClutterActor *window_container;
};

enum
{
  PROP_0,

  PROP_WINDOW_CONTAINER,

  PROP_LAST
};

static GParamSpec *obj_props[PROP_LAST] = { NULL, };

// struct _CinnamonWindowPreview
// {
//   /*< private >*/
//   StWidget parent_instance;

//   ClutterActor *window_container;
// };

G_DEFINE_TYPE_WITH_PRIVATE (CinnamonWindowPreview, cinnamon_window_preview, ST_TYPE_WIDGET);

static void
cinnamon_window_preview_get_property (GObject      *gobject,
                                   unsigned int  property_id,
                                   GValue       *value,
                                   GParamSpec   *pspec)
{
  CinnamonWindowPreview *self = CINNAMON_WINDOW_PREVIEW (gobject);
  CinnamonWindowPreviewPrivate *priv = self->priv;

  switch (property_id)
    {
    case PROP_WINDOW_CONTAINER:
      g_value_set_object (value, priv->window_container);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (gobject, property_id, pspec);
    }
}

static void
cinnamon_window_preview_set_property (GObject      *gobject,
                                   unsigned int  property_id,
                                   const GValue *value,
                                   GParamSpec   *pspec)
{
  CinnamonWindowPreview *self = CINNAMON_WINDOW_PREVIEW (gobject);
  CinnamonWindowPreviewPrivate *priv = self->priv;

  switch (property_id)
    {
    case PROP_WINDOW_CONTAINER:
      g_set_object (&priv->window_container, g_value_get_object (value));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (gobject, property_id, pspec);
    }
}

static void
cinnamon_window_preview_get_preferred_width (ClutterActor *actor,
                                          float         for_height,
                                          float        *min_width_p,
                                          float        *natural_width_p)
{
  CinnamonWindowPreview *self = CINNAMON_WINDOW_PREVIEW (actor);
  CinnamonWindowPreviewPrivate *priv = self->priv;
  StThemeNode *theme_node = st_widget_get_theme_node (ST_WIDGET (priv));
  float min_width, nat_width;

  st_theme_node_adjust_for_height (theme_node, &for_height);

  clutter_actor_get_preferred_width (priv->window_container, for_height,
                                     &min_width, &nat_width);

  st_theme_node_adjust_preferred_width (theme_node, &min_width, &nat_width);

  if (min_width_p)
    *min_width_p = min_width;

  if (natural_width_p)
    *natural_width_p = nat_width;
}

static void
cinnamon_window_preview_get_preferred_height (ClutterActor *actor,
                                           float         for_width,
                                           float        *min_height_p,
                                           float        *natural_height_p)
{
  CinnamonWindowPreview *self = CINNAMON_WINDOW_PREVIEW (actor);
  CinnamonWindowPreviewPrivate *priv = self->priv;
  StThemeNode *theme_node = st_widget_get_theme_node (ST_WIDGET (priv));
  float min_height, nat_height;

  st_theme_node_adjust_for_width (theme_node, &for_width);

  clutter_actor_get_preferred_height (priv->window_container, for_width,
                                      &min_height, &nat_height);

  st_theme_node_adjust_preferred_height (theme_node, &min_height, &nat_height);

  if (min_height_p)
    *min_height_p = min_height;

  if (natural_height_p)
    *natural_height_p = nat_height;
}

static void
cinnamon_window_preview_allocate (ClutterActor          *actor,
                               const ClutterActorBox *box,
                               ClutterAllocationFlags flags)
{
  StThemeNode *theme_node = st_widget_get_theme_node (ST_WIDGET (actor));
  ClutterActorBox content_box;
  float x, y, max_width, max_height;
  ClutterActorIter iter;
  ClutterActor *child;

  clutter_actor_set_allocation (actor, box, flags);

  st_theme_node_get_content_box (theme_node, box, &content_box);

  clutter_actor_box_get_origin (&content_box, &x, &y);
  clutter_actor_box_get_size (&content_box, &max_width, &max_height);

  clutter_actor_iter_init (&iter, actor);
  while (clutter_actor_iter_next (&iter, &child))
    clutter_actor_allocate_available_size (child, x, y, max_width, max_height, flags);
}

static void
cinnamon_window_preview_dispose (GObject *gobject)
{
  CinnamonWindowPreview *self = CINNAMON_WINDOW_PREVIEW (gobject);
  CinnamonWindowPreviewPrivate *priv = CINNAMON_WINDOW_PREVIEW (self)->priv;

  g_clear_object (&priv->window_container);

  G_OBJECT_CLASS (cinnamon_window_preview_parent_class)->dispose (gobject);
}

static void
cinnamon_window_preview_init (CinnamonWindowPreview *self)
{
}

static void
cinnamon_window_preview_class_init (CinnamonWindowPreviewClass *klass)
{
  ClutterActorClass *actor_class = CLUTTER_ACTOR_CLASS (klass);
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  actor_class->get_preferred_width = cinnamon_window_preview_get_preferred_width;
  actor_class->get_preferred_height = cinnamon_window_preview_get_preferred_height;
  actor_class->allocate = cinnamon_window_preview_allocate;

  gobject_class->dispose = cinnamon_window_preview_dispose;
  gobject_class->get_property = cinnamon_window_preview_get_property;
  gobject_class->set_property = cinnamon_window_preview_set_property;

  /**
   * CinnamonWindowPreview:window-container:
   */
  obj_props[PROP_WINDOW_CONTAINER] =
    g_param_spec_object ("window-container",
                         "window-container",
                         "window-container",
                         CLUTTER_TYPE_ACTOR,
                         G_PARAM_READWRITE |
                         G_PARAM_STATIC_STRINGS);

  g_object_class_install_properties (gobject_class, PROP_LAST, obj_props);
}

