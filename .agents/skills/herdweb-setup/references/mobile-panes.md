# Mobile pane navigation

herdr dashboards with many panes are hard to read on mobile — panes shrink to unreadable sizes. This guide shows how to navigate panes comfortably from your phone using herdweb's built-in features.

## The problem

When you swipe left/right in herdweb, it sends `\x02n` / `\x02p` by default — next/previous **herdr tab**. That's fine for tab switching, but it doesn't help when you have many panes in one tab. On mobile you want to zoom a pane to full screen and cycle through them.

## Double-tap zoom (recommended)

herdweb has a built-in double-tap gesture that sends any escape sequence when you double-tap the terminal screen. Combined with auto-zoom on load and a floating zoom button, this gives you full pane control:

**herdweb config** (`~/.config/herdweb/herdweb.config.ts`):

```typescript
export default {
  mobile: {
    initData: '\x02z',  // auto-zoom current pane on mobile load
  },
  gestures: {
    doubleTap: {
      enabled: true,
    },
  },
  floatingButtons: [
    {
      position: 'top-left',
      buttons: [
        {
          id: 'zoom',
          label: 'Zoom',
          description: 'Toggle pane zoom',
          action: { type: 'send', data: '\x02z' },
        },
      ],
    },
  ],
}
```

**Result:**
- Phone loads → current pane auto-zooms to full screen
- Double-tap terminal → toggle zoom on/off
- Tap floating Zoom button → toggle zoom
- Swipe left/right → navigate tabs (when swipe gestures are enabled)

## Mobile init data

Use `mobile.initData` to send an arbitrary string when herdweb loads on a narrow viewport (below `mobile.widthThreshold`, default 768px):

```typescript
export default {
  mobile: {
    initData: '\x02z',
  },
}
```

## Floating buttons

Add `floatingButtons` for always-visible quick actions on touch devices:

```typescript
export default {
  floatingButtons: [
    {
      position: 'top-left',
      buttons: [
        {
          id: 'zoom',
          label: 'Zoom',
          description: 'Toggle pane zoom',
          action: { type: 'send', data: '\x02z' },
        },
      ],
    },
  ],
}
```

## Configurable swipe commands

Override swipe gesture data and labels:

```typescript
export default {
  gestures: {
    swipe: {
      enabled: true,
      left: '\x02n',
      right: '\x02p',
      leftLabel: 'Next herdr tab',
      rightLabel: 'Previous herdr tab',
    },
  },
}
```

The `leftLabel`/`rightLabel` values appear in the help overlay.
