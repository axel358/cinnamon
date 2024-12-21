#ifndef __CINNAMON_WINDOW_PREVIEW_LAYOUT_H__
#define __CINNAMON_WINDOW_PREVIEW_LAYOUT_H__

G_BEGIN_DECLS

#include <clutter/clutter.h>

#define CINNAMON_TYPE_WINDOW_PREVIEW_LAYOUT (cinnamon_window_preview_layout_get_type ())
G_DECLARE_FINAL_TYPE (CinnamonWindowPreviewLayout, cinnamon_window_preview_layout,
                      CINNAMON, WINDOW_PREVIEW_LAYOUT, ClutterLayoutManager)

typedef struct _CinnamonWindowPreviewLayout CinnamonWindowPreviewLayout;
typedef struct _CinnamonWindowPreviewLayoutPrivate CinnamonWindowPreviewLayoutPrivate;

struct _CinnamonWindowPreviewLayout
{
  /*< private >*/
  ClutterLayoutManager parent;

  CinnamonWindowPreviewLayoutPrivate *priv;
};

ClutterActor * cinnamon_window_preview_layout_add_window (CinnamonWindowPreviewLayout  *self,
                                                       MetaWindow *window);

void  cinnamon_window_preview_layout_remove_window (CinnamonWindowPreviewLayout  *self,
                                                 MetaWindow *window);

GList * cinnamon_window_preview_layout_get_windows (CinnamonWindowPreviewLayout  *self);

G_END_DECLS

#endif /* __CINNAMON_WINDOW_PREVIEW_LAYOUT_H__ */

