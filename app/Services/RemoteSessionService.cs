using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using QRCoder;

namespace XenonEdgeHost;

public sealed class RemoteSessionService : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly SceneService _sceneService;
    private readonly ActionChainService _actionChains;
    private readonly HostLogger _logger;
    private readonly int _port;
    private HttpListener? _listener;
    private CancellationTokenSource? _cancellation;
    private string _token = "";
    private DateTimeOffset _expiresAt;
    private string _url = "";

    public RemoteSessionService(SceneService sceneService, ActionChainService actionChains, HostLogger logger, int dashboardPort)
    {
        _sceneService = sceneService;
        _actionChains = actionChains;
        _logger = logger;
        _port = dashboardPort + 1;
    }

    public object GetSnapshot()
    {
        var active = _listener?.IsListening == true && _expiresAt > DateTimeOffset.UtcNow;
        return new
        {
            supported = true,
            active,
            url = active ? _url : "",
            qrSvg = active ? BuildQrSvg(_url) : "",
            expiresAt = active ? _expiresAt.ToString("O") : "",
            localNetworkOnly = true,
            accountRequired = false,
            status = active ? "live" : "stopped",
            message = active ? "Temporary local phone remote is active." : "Start a temporary remote when you need it."
        };
    }

    public object Start()
    {
        Stop();
        var address = FindLocalAddress() ?? throw new InvalidOperationException("No private IPv4 network address is available.");
        _token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        _expiresAt = DateTimeOffset.UtcNow.AddMinutes(15);
        _url = $"http://{address}:{_port}/?token={Uri.EscapeDataString(_token)}";
        var listener = new HttpListener();
        listener.Prefixes.Add($"http://{address}:{_port}/");
        try
        {
            listener.Start();
        }
        catch (Exception error)
        {
            listener.Close();
            _logger.Warn($"Temporary phone remote could not bind: {error.Message}");
            throw new InvalidOperationException("Windows blocked the temporary LAN listener. Allow Auxora through the private-network firewall, then retry.", error);
        }
        _listener = listener;
        _cancellation = new CancellationTokenSource();
        _ = Task.Run(() => RunAsync(listener, _cancellation.Token));
        _logger.Info($"Temporary Auxora remote started on {address}:{_port} for 15 minutes.");
        return GetSnapshot();
    }

    public object Stop()
    {
        _cancellation?.Cancel();
        _cancellation?.Dispose();
        _cancellation = null;
        if (_listener is not null)
        {
            try { _listener.Stop(); } catch { }
            _listener.Close();
            _listener = null;
        }
        _token = "";
        _url = "";
        _expiresAt = default;
        return GetSnapshot();
    }

    public void Dispose() => Stop();

    private async Task RunAsync(HttpListener listener, CancellationToken cancellationToken)
    {
        while (listener.IsListening && !cancellationToken.IsCancellationRequested && _expiresAt > DateTimeOffset.UtcNow)
        {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync(); }
            catch { break; }
            _ = Task.Run(() => HandleAsync(context, cancellationToken), cancellationToken);
        }
        if (_expiresAt <= DateTimeOffset.UtcNow)
        {
            Stop();
        }
    }

    private async Task HandleAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        try
        {
            var token = context.Request.QueryString["token"] ?? context.Request.Headers["X-Auxora-Remote"] ?? "";
            if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(token), Encoding.UTF8.GetBytes(_token)) || _expiresAt <= DateTimeOffset.UtcNow)
            {
                await WriteJson(context.Response, 403, new { error = "Remote session token is invalid or expired." }, cancellationToken);
                return;
            }

            var path = context.Request.Url?.AbsolutePath ?? "/";
            if (path == "/" && context.Request.HttpMethod == "GET")
            {
                var html = BuildRemoteHtml(token);
                var bytes = Encoding.UTF8.GetBytes(html);
                context.Response.ContentType = "text/html; charset=utf-8";
                context.Response.ContentLength64 = bytes.Length;
                await context.Response.OutputStream.WriteAsync(bytes, cancellationToken);
                context.Response.Close();
                return;
            }
            if (path == "/api/status" && context.Request.HttpMethod == "GET")
            {
                await WriteJson(context.Response, 200, new { scenes = _sceneService.GetSnapshot(), chains = _actionChains.GetSnapshot(), expiresAt = _expiresAt }, cancellationToken);
                return;
            }
            if (path == "/api/scenes/activate" && context.Request.HttpMethod == "POST")
            {
                var request = await JsonSerializer.DeserializeAsync<SceneActivationRequest>(context.Request.InputStream, JsonOptions, cancellationToken) ?? new SceneActivationRequest();
                await WriteJson(context.Response, 200, _sceneService.Activate(request), cancellationToken);
                return;
            }
            if (path == "/api/action-chains/execute" && context.Request.HttpMethod == "POST")
            {
                var request = await JsonSerializer.DeserializeAsync<ActionChainExecuteRequest>(context.Request.InputStream, JsonOptions, cancellationToken) ?? new ActionChainExecuteRequest();
                await WriteJson(context.Response, 200, _actionChains.Execute(request), cancellationToken);
                return;
            }
            await WriteJson(context.Response, 404, new { error = "Not found." }, cancellationToken);
        }
        catch (Exception error)
        {
            await WriteJson(context.Response, 400, new { error = error.Message }, cancellationToken);
        }
    }

    private string BuildRemoteHtml(string token)
    {
        var safeToken = JsonSerializer.Serialize(token);
        var html = """
            <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auxora Remote</title>
            <style>body{font:16px system-ui;background:#071018;color:#eef;padding:20px}button{min-height:56px;padding:12px 18px;margin:6px;border:1px solid #2ce0ff55;border-radius:14px;background:#10232d;color:#fff;font-weight:700}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.muted{color:#9ab}</style></head>
            <body><h1>Auxora Remote</h1><p class="muted">Temporary local session · expires in 15 minutes</p><h2>Scenes</h2><div id="scenes" class="grid"></div><h2>One-tap chains</h2><div id="chains" class="grid"></div>
            <script>const token=__AUXORA_TOKEN__;const api=(path,options={})=>fetch(path+'?token='+encodeURIComponent(token),{...options,headers:{'Content-Type':'application/json'}}).then(r=>r.json());
            function load(){api('/api/status').then(x=>{const s=x.scenes;document.querySelector('#scenes').innerHTML=s.profiles.map(v=>`<button onclick="scene('${v.id}')">${v.name}${v.id===s.activeSceneId?' · Active':''}</button>`).join('');document.querySelector('#chains').innerHTML=x.chains.chains.map(v=>`<button onclick="chain('${v.id}')">${v.name}</button>`).join('')})}function scene(id){api('/api/scenes/activate',{method:'POST',body:JSON.stringify({sceneId:id,manualOverrideMinutes:120})}).then(load)}function chain(id){api('/api/action-chains/execute',{method:'POST',body:JSON.stringify({chainId:id})}).then(load)}load();</script></body></html>
            """;
        return html.Replace("__AUXORA_TOKEN__", safeToken, StringComparison.Ordinal);
    }

    private static async Task WriteJson(HttpListenerResponse response, int status, object payload, CancellationToken token)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
        response.StatusCode = status;
        response.ContentType = "application/json; charset=utf-8";
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes, token);
        response.Close();
    }

    private static string? FindLocalAddress()
    {
        return NetworkInterface.GetAllNetworkInterfaces()
            .Where(adapter => adapter.OperationalStatus == OperationalStatus.Up && adapter.NetworkInterfaceType is not NetworkInterfaceType.Loopback)
            .SelectMany(adapter => adapter.GetIPProperties().UnicastAddresses)
            .Select(address => address.Address)
            .FirstOrDefault(address => address.AddressFamily == AddressFamily.InterNetwork && IsPrivate(address))?.ToString();
    }

    private static bool IsPrivate(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        return bytes[0] == 10 || bytes[0] == 192 && bytes[1] == 168 || bytes[0] == 172 && bytes[1] is >= 16 and <= 31;
    }

    private static string BuildQrSvg(string value)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(value, QRCodeGenerator.ECCLevel.Q);
        return new SvgQRCode(data).GetGraphic(4);
    }
}
