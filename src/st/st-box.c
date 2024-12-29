/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*- */
/*
 * st-box.c: Basic container actor
 *
 * Copyright 2009 Intel Corporation.
 * Copyright 2009, 2010 Red Hat, Inc.
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

/**
 * SECTION:st-box
 * @short_description: a simple container with one actor
 *
 * #StBox is a simple container capable of having only one
 * #ClutterActor as a child.
 *
 * #StBox inherits from #StWidget, so it is fully themable.
 */

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include <clutter/clutter.h>

#include "st-box.h"
#include "st-enum-types.h"
#include "st-private.h"

struct _StBoxPrivate
{
  ClutterActor *child;
};

enum
{
  PROP_0,

  PROP_CHILD,
};

static void clutter_container_iface_init (ClutterContainerIface *iface);

G_DEFINE_TYPE_WITH_CODE (StBox, st_box, ST_TYPE_WIDGET,
                         G_ADD_PRIVATE (StBox)
                         G_IMPLEMENT_INTERFACE (CLUTTER_TYPE_CONTAINER,
                                                clutter_container_iface_init));

static void
st_box_add (ClutterContainer *container,
            ClutterActor     *actor)
{
  st_box_set_child (ST_BOX (container), actor);
}

static void
st_box_remove (ClutterContainer *container,
               ClutterActor     *actor)
{
  StBoxPrivate *priv = ST_BOX (container)->priv;

  if (priv->child == actor)
    st_box_set_child (ST_BOX (container), NULL);
}

static void
st_box_foreach (ClutterContainer *container,
                ClutterCallback   callback,
                gpointer          user_data)
{
  StBoxPrivate *priv = ST_BOX (container)->priv;

  callback (priv->child, user_data);
}

static void
clutter_container_iface_init (ClutterContainerIface *iface)
{
  iface->add = st_box_add;
  iface->remove = st_box_remove;
}

static void
st_box_destroy (ClutterActor *actor)
{
  StBoxPrivate *priv = ST_BOX (actor)->priv;

  if (priv->child)
    clutter_actor_destroy (priv->child);
  g_assert (priv->child == NULL);

  CLUTTER_ACTOR_CLASS (st_box_parent_class)->destroy (actor);
}

static void
st_box_popup_menu (StWidget *widget)
{
  StBoxPrivate *priv = ST_BOX (widget)->priv;

  if (priv->child && ST_IS_WIDGET (priv->child))
    st_widget_popup_menu (ST_WIDGET (priv->child));
}

static gboolean
st_box_navigate_focus (StWidget         *widget,
                       ClutterActor     *from,
                       GtkDirectionType  direction)
{
  StBoxPrivate *priv = ST_BOX (widget)->priv;
  ClutterActor *box_actor = CLUTTER_ACTOR (widget);

  if (st_widget_get_can_focus (widget))
    {
      if (from && clutter_actor_contains (box_actor, from))
        return FALSE;

      clutter_actor_grab_key_focus (box_actor);
      return TRUE;
    }
  else if (priv->child && ST_IS_WIDGET (priv->child))
    return st_widget_navigate_focus (ST_WIDGET (priv->child), from, direction, FALSE);
  else
    return FALSE;
}

static void
st_box_set_property (GObject      *gobject,
                     guint         prop_id,
                     const GValue *value,
                     GParamSpec   *pspec)
{
  StBox *box = ST_BOX (gobject);

  switch (prop_id)
    {
    case PROP_CHILD:
      st_box_set_child (box, g_value_get_object (value));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (gobject, prop_id, pspec);
    }
}

static void
st_box_get_property (GObject    *gobject,
                     guint       prop_id,
                     GValue     *value,
                     GParamSpec *pspec)
{
  StBoxPrivate *priv = ST_BOX (gobject)->priv;

  switch (prop_id)
    {
    case PROP_CHILD:
      g_value_set_object (value, priv->child);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (gobject, prop_id, pspec);
    }
}

static void
st_box_class_init (StBoxClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  ClutterActorClass *actor_class = CLUTTER_ACTOR_CLASS (klass);
  StWidgetClass *widget_class = ST_WIDGET_CLASS (klass);
  GParamSpec *pspec;

  gobject_class->set_property = st_box_set_property;
  gobject_class->get_property = st_box_get_property;

  actor_class->destroy = st_box_destroy;

  widget_class->popup_menu = st_box_popup_menu;
  widget_class->navigate_focus = st_box_navigate_focus;

  /**
   * StBox:child:
   *
   * The child #ClutterActor of the #StBox container.
   */
  pspec = g_param_spec_object ("child",
                               "Child",
                               "The child of the Box",
                               CLUTTER_TYPE_ACTOR,
                               ST_PARAM_READWRITE);
  g_object_class_install_property (gobject_class, PROP_CHILD, pspec);

  clutter_actor_class_set_layout_manager_type (actor_class, CLUTTER_TYPE_BIN_LAYOUT);
}

static void
st_box_init (StBox *box)
{
}

/**
 * st_box_new:
 *
 * Creates a new #StBox, a simple container for one child.
 *
 * Return value: the newly created #StBox actor
 */
StWidget *
st_box_new (void)
{
  return g_object_new (ST_TYPE_BOX, NULL);
}

/**
 * st_box_set_child:
 * @box: a #StBox
 * @child: (allow-none): a #ClutterActor, or %NULL
 *
 * Sets @child as the child of @box.
 *
 * If @box already has a child, the previous child is removed.
 */
void
st_box_set_child (StBox        *box,
                  ClutterActor *child)
{
  StBoxPrivate *priv;

  g_return_if_fail (ST_IS_BOX (box));
  g_return_if_fail (child == NULL || CLUTTER_IS_ACTOR (child));

  priv = box->priv;

  if (priv->child == child)
    return;

  if (child)
  {
    ClutterActor *parent = clutter_actor_get_parent (child);

    if (parent)
      {
        g_warning ("%s: The provided 'child' actor %p already has a "
                   "(different) parent %p and can't be made a child of %p.",
                   G_STRFUNC, child, parent, box);
        return;
      }
  }

  if (priv->child)
    clutter_actor_remove_child (CLUTTER_ACTOR (box), priv->child);

  priv->child = NULL;

  if (child)
    {
      priv->child = child;
      clutter_actor_add_child (CLUTTER_ACTOR (box), child);
    }

  clutter_actor_queue_relayout (CLUTTER_ACTOR (box));

  g_object_notify (G_OBJECT (box), "child");
}

/**
 * st_box_get_child:
 * @box: a #StBox
 *
 * Retrieves a pointer to the child of @box.
 *
 * Return value: (transfer none): a #ClutterActor, or %NULL
 */
ClutterActor *
st_box_get_child (StBox *box)
{
  g_return_val_if_fail (ST_IS_BOX (box), NULL);

  return box->priv->child;
}
