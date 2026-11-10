using System.Drawing;

namespace XenonEdgeHost;

// Pure decision logic for putting the Windows cursor back where the user left
// it after the companion display is touched. The page reports real touch
// pointers (pointerType "touch"); the mouse hook only records where the cursor
// has been, so the position from before the touch moved it is still known.
internal sealed class TouchCursorPolicy
{
    internal const long SettleMilliseconds = 150;
    // The page learns about a touch a few milliseconds after the cursor has
    // already moved, so the pre-touch position is the last one older than this.
    internal const long AnchorLagMilliseconds = 200;
    internal const long HistoryMilliseconds = 2_000;
    // A touch whose release never arrives (navigation, lost focus) must not
    // keep the session open forever.
    internal const long StuckTouchMilliseconds = 5_000;

    private readonly object _gate = new();
    private readonly List<(long At, Point Position)> _history = [];
    private readonly HashSet<int> _pointers = [];
    private bool _active;
    private long _lastActivityMilliseconds;
    private Point _anchor;

    // Called for every cursor position the mouse hook sees.
    internal void OnCursorMoved(Point position, long nowMs)
    {
        lock (_gate)
        {
            _history.Add((nowMs, position));
            // Keep one entry older than the window: it is where a parked
            // cursor was last seen.
            while (_history.Count > 1 && _history[1].At <= nowMs - HistoryMilliseconds)
            {
                _history.RemoveAt(0);
            }

            if (_active)
            {
                _lastActivityMilliseconds = nowMs;
            }
        }
    }

    // Called when the page reports a touch pointer going down or up.
    internal void OnTouch(bool down, int pointerId, long nowMs, Point cursorNow)
    {
        lock (_gate)
        {
            _lastActivityMilliseconds = nowMs;
            if (!down)
            {
                _pointers.Remove(pointerId);
                return;
            }

            if (!_active)
            {
                _active = true;
                _anchor = PreTouchPosition(nowMs) ?? cursorNow;
            }

            _pointers.Add(pointerId);
        }
    }

    // Returns the position the cursor must be moved back to, or null.
    internal Point? Tick(long nowMs, Point cursorNow)
    {
        lock (_gate)
        {
            if (!_active)
            {
                return null;
            }

            var idle = nowMs - _lastActivityMilliseconds;
            if (_pointers.Count > 0 && idle >= StuckTouchMilliseconds)
            {
                _pointers.Clear();
            }

            if (_pointers.Count > 0 || idle < SettleMilliseconds)
            {
                return null;
            }

            _active = false;
            if (cursorNow == _anchor)
            {
                return null;
            }

            // Forget the positions the touch produced; the next touch must
            // anchor on the restored cursor, not on where the finger was.
            _history.Clear();
            _history.Add((nowMs, _anchor));
            return _anchor;
        }
    }

    private Point? PreTouchPosition(long nowMs)
    {
        for (var index = _history.Count - 1; index >= 0; index--)
        {
            if (_history[index].At <= nowMs - AnchorLagMilliseconds)
            {
                return _history[index].Position;
            }
        }

        return _history.Count > 0 ? _history[0].Position : null;
    }
}
