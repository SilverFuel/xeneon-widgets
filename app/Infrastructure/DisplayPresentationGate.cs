namespace XenonEdgeHost;

// Coordinates topology notifications with the final UI-thread reveal. Never hold
// this gate while enumerating displays, placing a window, hiding it from another
// thread, or waiting for dispatcher work.
internal sealed class DisplayPresentationGate
{
    private readonly object _sync = new();
    private CancellationTokenSource? _topologyRequest;
    private long _topologyGeneration;
    private int _presentationGeneration;
    private bool _stopped;

    internal bool TryBeginTopologyChange(
        CancellationTokenSource request,
        out CancellationTokenSource? previousRequest)
    {
        lock (_sync)
        {
            previousRequest = _topologyRequest;
            if (_stopped)
            {
                return false;
            }

            _topologyRequest = request;
            _topologyGeneration++;
            _presentationGeneration++;
            return true;
        }
    }

    internal bool IsCurrentTopologyRequest(CancellationTokenSource request)
    {
        lock (_sync)
        {
            return !_stopped && ReferenceEquals(_topologyRequest, request);
        }
    }

    internal void CompleteTopologyChange(CancellationTokenSource request)
    {
        lock (_sync)
        {
            if (ReferenceEquals(_topologyRequest, request))
            {
                _topologyRequest = null;
            }
        }
    }

    internal bool TryCaptureReveal(CancellationTokenSource? topologyRequest, out long generation)
    {
        lock (_sync)
        {
            generation = _topologyGeneration;
            return CanReveal(topologyRequest);
        }
    }

    internal bool TryReveal(long generation, CancellationTokenSource? topologyRequest, Action showWindow)
    {
        lock (_sync)
        {
            if (generation != _topologyGeneration || !CanReveal(topologyRequest))
            {
                return false;
            }

            // Only the final, synchronous UI-thread ShowWindow belongs here.
            // Background topology registration never calls native APIs under
            // this lock, so it cannot hold the gate while waiting for the UI.
            showWindow();
            // A successful topology reveal ends the hidden burst now, not when
            // its asynchronous request finally unwinds. The next notification
            // must begin a new burst and hide this newly visible window.
            if (topologyRequest is not null && ReferenceEquals(_topologyRequest, topologyRequest))
            {
                _topologyRequest = null;
            }
            return true;
        }
    }

    internal int InvalidatePresentation()
    {
        lock (_sync)
        {
            return ++_presentationGeneration;
        }
    }

    internal bool IsCurrentPresentation(int generation)
    {
        lock (_sync)
        {
            return !_stopped && _topologyRequest is null && generation == _presentationGeneration;
        }
    }

    internal CancellationTokenSource? Stop()
    {
        lock (_sync)
        {
            _stopped = true;
            _presentationGeneration++;
            var request = _topologyRequest;
            _topologyRequest = null;
            return request;
        }
    }

    internal static uint BuildTopmostFlags(bool includeFrameChanged = false)
    {
        const uint noSize = 0x0001;
        const uint noMove = 0x0002;
        const uint noActivate = 0x0010;
        const uint frameChanged = 0x0020;
        const uint noOwnerZOrder = 0x0200;
        // Raise only our window, not its owner: changing owner z-order can be
        // denied while another application has foreground permission. Keep
        // focus and visibility unchanged, including during display recovery.
        // Z-order maintenance must never contain SWP_SHOWWINDOW (0x0040).
        return noSize | noMove | noActivate | noOwnerZOrder | (includeFrameChanged ? frameChanged : 0u);
    }

    private bool CanReveal(CancellationTokenSource? topologyRequest)
    {
        return !_stopped && ReferenceEquals(_topologyRequest, topologyRequest);
    }
}
