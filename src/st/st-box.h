/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*- */
/*
 * st-box.h: Basic container actor
 *
 * Copyright 2009, 2008 Intel Corporation.
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms and conditions of the GNU Lesser General Public License,
 * version 2.1, as published by the Free Software Foundation.
 *
 * This program is distributed in the hope it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU Lesser General Public License for
 * more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

#if !defined(ST_H_INSIDE) && !defined(ST_COMPILATION)
#error "Only <st/st.h> can be included directly.h"
#endif

#ifndef __ST_BOX_H__
#define __ST_BOX_H__

#include "st-types.h"
#include "st-widget.h"

G_BEGIN_DECLS

#define ST_TYPE_BOX                   (st_box_get_type ())
#define ST_BOX(obj)                   (G_TYPE_CHECK_INSTANCE_CAST ((obj), ST_TYPE_BOX, StBox))
#define ST_IS_BOX(obj)                (G_TYPE_CHECK_INSTANCE_TYPE ((obj), ST_TYPE_BOX))
#define ST_BOX_CLASS(klass)           (G_TYPE_CHECK_CLASS_CAST ((klass), ST_TYPE_BOX, StBoxClass))
#define ST_IS_BOX_CLASS(klass)        (G_TYPE_CHECK_CLASS_TYPE ((klass), ST_TYPE_BOX))
#define ST_BOX_GET_CLASS(obj)         (G_TYPE_INSTANCE_GET_CLASS ((obj), ST_TYPE_BOX, StBoxClass))

typedef struct _StBox                 StBox;
typedef struct _StBoxPrivate          StBoxPrivate;
typedef struct _StBoxClass            StBoxClass;

/**
 * StBox:
 *
 * The #StBox struct contains only private data
 */
struct _StBox
{
  /*< private >*/
  StWidget parent_instance;

  StBoxPrivate *priv;
};

/**
 * StBoxClass:
 *
 * The #StBoxClass struct contains only private data
 */
struct _StBoxClass
{
  /*< private >*/
  StWidgetClass parent_class;
};

GType st_box_get_type (void) G_GNUC_CONST;

StWidget   *  st_box_new           (void);
void          st_box_set_child     (StBox        *box,
                                    ClutterActor *child);
ClutterActor *st_box_get_child     (StBox        *box);

G_END_DECLS

#endif /* __ST_BOX_H__ */
