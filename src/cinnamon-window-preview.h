#ifndef __CINNAMON_WINDOW_PREVIEW_H__
#define __CINNAMON_WINDOW_PREVIEW_H__

#include <st/st.h>

G_BEGIN_DECLS

#define CINNAMON_TYPE_WINDOW_PREVIEW                 (st_widget_get_type ())
#define CINNAMON_WINDOW_PREVIEW(obj)                 (G_TYPE_CHECK_INSTANCE_CAST ((obj), CINNAMON_TYPE_WINDOW_PREVIEW, CinnamonWindowPreview))
#define CINNAMON_IS_WINDOW_PREVIEW(obj)              (G_TYPE_CHECK_INSTANCE_TYPE ((obj), CINNAMON_TYPE_WINDOW_PREVIEW))
#define CINNAMON_WINDOW_PREVIEW_CLASS(klass)         (G_TYPE_CHECK_CLASS_CAST ((klass), CINNAMON_TYPE_WINDOW_PREVIEW, CinnamonWindowPreviewClass))
#define CINNAMON_IS_WINDOW_PREVIEW_CLASS(klass)      (G_TYPE_CHECK_CLASS_TYPE ((klass), CINNAMON_TYPE_WINDOW_PREVIEW))
#define CINNAMON_WINDOW_PREVIEW_GET_CLASS(obj)       (G_TYPE_INSTANCE_GET_CLASS ((obj), CINNAMON_TYPE_WINDOW_PREVIEW, CinnamonWindowPreviewClass))

typedef struct _CinnamonWindowPreview               CinnamonWindowPreview;
typedef struct _CinnamonWindowPreviewPrivate        CinnamonWindowPreviewPrivate;
typedef struct _CinnamonWindowPreviewClass          CinnamonWindowPreviewClass;

struct _CinnamonWindowPreview
{
  /*< private >*/
  StWidget parent_instance;

  CinnamonWindowPreview *priv;

  // ClutterActor *window_container;
};

struct _CinnamonWindowPreviewClass
{
  /*< private >*/
  StWidget parent_class;
};

GType cinnamon_window_preview_get_type (void) G_GNUC_CONST;

// #define CINNAMON_TYPE_WINDOW_PREVIEW (cinnamon_window_preview_get_type ())
// G_DECLARE_FINAL_TYPE (CinnamonWindowPreview, cinnamon_window_preview,
//                       CINNAMON, WINDOW_PREVIEW, StWidget)

G_END_DECLS

#endif /* __CINNAMON_WINDOW_PREVIEW_H__ */

