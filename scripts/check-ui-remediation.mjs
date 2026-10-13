import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dashboard = read("js/dashboard.js");
const html = read("dashboard.html");
const css = read("css/widgets.css");
const themeCss = read("css/theme.css");
const widgetCore = read("js/widget-core.js");
const productCss = read("css/widgets/product.css");
const gameCss = read("css/widgets/game-mode.css");
const networkCss = read("css/widgets/network.css");
const systemCss = read("css/widgets/system.css");
const audioCss = read("css/widgets/audio.css");
const product = read("js/widgets/product.js");
const inline = read("js/inline-widgets.js");
const system = read("js/widgets/system.js");
const network = read("js/widgets/network.js");
const audio = read("js/widgets/audio.js");
const actions = read("js/widgets/actions.js");
const homelab = read("js/widgets/homelab.js");
const integrations = read("js/widgets/integrations.js");
const setup = read("js/widgets/setup.js");
const gameMode = read("js/widgets/game-mode.js");
const sceneDefaults = read("app/Services/SceneDefaults.cs");
const sceneService = read("app/Services/SceneService.cs");
const systemMetrics = read("app/Services/SystemMetricsService.cs");
const standaloneSystem = read("widgets/system-monitor.html");
const standaloneSetup = read("widgets/setup-guide.html");
const standaloneAudio = read("widgets/audio-output-panel.html");
const standaloneCalendar = read("widgets/calendar-widget.html");
const standaloneNetwork = read("widgets/network-widget.html");
const standaloneHue = read("widgets/philips-hue-panel.html");
const standaloneWeather = read("widgets/weather-widget.html");
const standaloneAutomation = read("widgets/home-automation-panel.html");
const standaloneNas = read("widgets/nas-storage-monitor.html");
const standalonePlex = read("widgets/plex-server-monitor.html");
const audioStyles = read("css/widgets/audio.css");
const appConfig = read("app/Models/AppConfig.cs");
const configStore = read("app/Infrastructure/ConfigStore.cs");
const configController = read("app/Controllers/ConfigController.cs");
const bridgeManager = read("app/BridgeManager.cs");
const supportController = read("app/Controllers/SupportController.cs");
const themeStudioSource = product.slice(
  product.indexOf("function mountThemeStudioWidget"),
  product.indexOf("function mountLayoutEditorWidget")
);
const homeSource = product.slice(
  product.indexOf("function mountAuxoraHomeWidget"),
  product.indexOf("function mountScenesWidget")
);

const canonicalIds = [
  "home", "scenes", "setup", "theme-studio", "updates", "layout-editor", "streaming",
  "marketplace", "privacy", "remote", "installer", "game-mode", "system", "network",
  "audio", "quick-actions", "shortcuts", "display-controls", "clipboard", "weather",
  "calendar", "hue", "frigate"
];
for (const id of canonicalIds) {
  assert(new RegExp(`(?:^|\\n)\\s*(?:"${id}"|${id.replaceAll("-", "\\-")}): \\{ destination:`).test(dashboard), `surface contract missing for ${id}`);
}
assert(/return widgets\.filter[\s\S]*?\[0\] \|\| null;/.test(dashboard), "unknown panel IDs must return null");
assert(/return sortWidgetsByLayout\(ids\.map\(getWidgetById\)\.filter\([\s\S]*?shouldShowWidget\(widget\)/.test(dashboard), "all destinations must use canonical visibility and ordering");
assert(/modeLayouts/.test(dashboard) && /getCardSize\(widget\.id\)/.test(dashboard), "Mode layout order and card sizes must affect production navigation");
assert(!/layout:\s*\[[^\]]*"(?:nas|plex|unifi-camera|automation)"/.test(product), "shipped packs must not reference unregistered planned panels");

const rendererSources = [system, network, audio, actions, homelab, integrations, setup, product, gameMode].join("\n");
for (const id of canonicalIds) {
  assert(new RegExp(`registerRenderer\\("${id.replaceAll("-", "\\-")}"`).test(rendererSources), `shipped surface ${id} must have a registered inline renderer`);
}
assert(/if \(widget\.id === "clipboard"\) \{[\s\S]*?return isWidgetSupported\(widget\.id\);/.test(dashboard), "Clipboard History must remain discoverable without reading clipboard contents during health checks");
assert(/widget\.id === "weather" \|\| widget\.id === "hue" \|\| widget\.id === "calendar" \|\| widget\.id === "frigate"[\s\S]*?return true;/.test(dashboard), "optional integrations must remain discoverable before configuration");
assert(/getLayoutEditorWidgets\(\)[\s\S]*?widget\.destination === "library";/.test(dashboard) && !/widget\.destination === "library" && widget\.id !== "clipboard"/.test(dashboard), "Layout Editor must include the discoverable Clipboard History surface");
assert(/optionalIntegration[\s\S]*?!optionalIntegration \|\| isWidgetConfigured\(id\)/.test(dashboard), "unconfigured optional integrations must stay out of ordinary Mode layouts while remaining discoverable in Apps & Controls");
assert(!/Optional integrations stay tucked away|Optional panels appear only after they are set up/.test(dashboard), "navigation copy must not claim discoverable optional surfaces are hidden");
assert(/Set up Weather[\s\S]*?data-action="setup"[\s\S]*?openSetupSection\("weather"\)/.test(integrations), "unconfigured Weather must provide a direct Diagnostics handoff");
assert(/data-action="setup">Open Calendar setup[\s\S]*?openSetupSection\("calendar"\)/.test(setup), "unconfigured Calendar must provide a direct Calendar setup handoff");
assert(!/Inline migration|still being converted|Panel still moving off iframe|remaining widget conversions/.test(inline), "renderer fallback must show a user-facing unavailable state instead of internal migration copy");
assert(/Panel unavailable/.test(inline) && /Panel renderer unavailable/.test(inline), "renderer fallback must provide a truthful recovery state");

assert(!/layout-(?:portrait|compact)[\s\S]{0,180}\.router-rail__lower[\s\S]{0,40}display:\s*none/.test(css), "compact navigation must not hide secondary panels");
assert(/layout-compact \.router-favorites\s*\{[^}]*overflow-x:\s*auto;[^}]*touch-action:\s*pan-x;/.test(css), "compact favorites must remain horizontally scrollable with touch");
assert(/dashboard-favorites-bar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/.test(css), "All panels must keep a reserved position outside the scrolling favorites");
assert(/id="dashboard-favorites"/.test(html) && /id="dashboard-panels-toggle"[^>]*aria-controls="dashboard-panels-drawer"/.test(html), "favorites must retain an accessible All panels entry point");
assert(/id="dashboard-panels-drawer"[^>]*role="dialog"[^>]*aria-modal="true"/.test(html) && /id="dashboard-widget-picker"/.test(html), "all panels must remain accessible from their own modal catalog");
assert(/\.auxora-panels-drawer \.router-picker\s*\{[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;/.test(css), "the full catalog must scroll vertically with touch");
assert(/router-viewer__header-actions[\s\S]*?dashboard-quick-toggle/.test(html), "Quick controls must occupy reserved viewer chrome");
assert(/role="dialog"[\s\S]*?aria-modal="true"/.test(html) && /event\.key === "Escape"/.test(dashboard), "Quick controls must implement dialog keyboard behavior");
assert(/outline:\s*3px solid var\(--theme-focus-ring\)/.test(css) && /auxora-primary-nav/.test(css), "primary navigation must use themed focus rings");
assert(/--theme-accent-text:\s*var\(--theme-accent\)/.test(themeCss), "themes must expose a semantic accent foreground token");
assert(/contrastSafeAccentTextColor\(accent, getThemeSurfaceColors\(theme\)\)/.test(dashboard), "custom accents must derive a contrast-safe foreground without replacing the chosen accent");
assert(/return blackContrast >= whiteContrast \? "#000000" : "#ffffff";/.test(dashboard), "on-accent text must compare and return the same black and white candidates");
assert(!/(?:^|\n)\s*color:\s*var\(--(?:color|theme)-accent\);/.test(css), "accent-colored foregrounds must use the contrast-safe accent text token");
assert(/dashboard-native-page--readability-high-contrast\s*\{[\s\S]*?--theme-text:\s*#ffffff;[\s\S]*?--theme-text-muted:\s*#e6edf3;[\s\S]*?--theme-border:\s*rgba\(255, 255, 255, 0\.4\);[\s\S]*?--theme-focus-ring:\s*#ffffff;[\s\S]*?--theme-panel-shadow:\s*none;/.test(themeCss), "High contrast must strengthen semantic text, boundaries, focus, and effects rather than only dim decoration");
assert(/reducedMotionQuery\.addEventListener\("change", handleReducedMotionChange\)/.test(dashboard) && /canvas\.dataset\.ambientMotion = "paused"/.test(dashboard), "ambient graphics must stop when reduced motion changes at runtime");
assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.router-picker__button::before\s*\{[\s\S]*?transition:\s*none/.test(css), "picker pseudo-element motion must stop for reduced motion");
assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.product-card--button::after,[\s\S]*?\.product-swatch::after,[\s\S]*?transition:\s*none/.test(productCss), "product pseudo-element motion must stop for reduced motion");
assert(/\.audio-album-carousel:focus-visible\s*\{[\s\S]*?outline:\s*3px solid var\(--theme-focus-ring\)/.test(audioCss), "keyboard audio carousel must expose the semantic 3px focus ring");
assert(/body\.dashboard-native-page :where\([^{}]*\.router-settings__field input,[^{}]*\.router-settings__field select\s*\):focus-visible\s*\{[^{}]*outline:\s*3px solid var\(--theme-focus-ring\)/.test(css), "router settings controls must receive the shared visible focus ring");
assert(/min-(?:block-size|height):\s*44px/.test(css), "touch controls must enforce the 44px minimum");
assert(/\.inline-button\s*\{[\s\S]*?min-width:\s*44px/.test(css), "compact inline actions must enforce the 44px horizontal touch minimum");
assert(/\.system-health-card span,[\s\S]*?font-size:\s*max\(12px, 0\.75rem\)/.test(systemCss), "System Monitor supporting text must remain at least 12px");
assert(/\.audio-route-button strong\s*\{[\s\S]*?font-size:\s*max\(12px, 0\.75rem\)/.test(audioCss), "Audio route labels must remain at least 12px");
assert(/\.network-quality-score span,[\s\S]*?font-size:\s*max\(12px, 0\.75rem\)/.test(networkCss), "Network readiness labels must remain at least 12px");
assert(/@media \(max-width: 1800px\)[\s\S]*?\.auxora-primary-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/.test(css), "supported narrow layouts must not clip the four primary navigation labels");
assert(/aria-label="Open panel options"/.test(html) && /aria-controls="dashboard-widget-settings"/.test(html), "panel options must not duplicate the primary Settings control name");
assert(/"Close panel options" : "Open panel options"/.test(dashboard), "panel options must publish distinct expanded and collapsed accessible names");
assert(/id="dashboard-touch-lock-scrim"/.test(html) && /toggleAttribute\("inert", locked\)/.test(dashboard) && /function blockLockedInteraction\(event\)/.test(dashboard) && /focusTarget\.focus\(\{ preventScroll: true \}\)/.test(dashboard), "Touch Lock must block pointer and keyboard interaction while keeping one focusable unlock control");
assert(/\.dashboard-touch-lock-scrim[\s\S]{0,220}touch-action:\s*none/.test(css) && /dashboard-native-page--browser \.dashboard-touch-lock-scrim/.test(css), "Touch Lock must cover native and browser viewports without an opaque blocker");
assert(!/dashboard-diagnostics-rail/.test(html + dashboard), "Diagnostics must not consume a redundant opaque rail card");
assert(/grid-template-columns:\s*max-content minmax\(0, 1fr\)/.test(css), "rail status chips must reserve truthful setup status without clipping the panel name");
assert(/setText\("dashboard-selection-status", getWidgetTitle\(widget\)\)/.test(dashboard), "selected-panel status must use the concise panel name");
assert(/id: "setup",\s*title: "Diagnostics",\s*kicker: "Setup & diagnostics"/.test(dashboard) && !/"Auto Setup"/.test(dashboard), "setup and repair must keep the stable customer-facing Diagnostics name before and after onboarding");
assert(
  /kicker: "Quick Look"/.test(dashboard)
    && /Current Setup/.test(homeSource)
    && /PC Activity/.test(homeSource)
    && /Memory Used/.test(homeSource)
    && /Network Response/.test(homeSource)
    && /Next Event/.test(homeSource)
    && /Shortcuts/.test(homeSource)
    && /PC details/.test(homeSource)
    && /Customize Home/.test(homeSource)
    && /One-tap setups/.test(homeSource)
    && /Change several settings with one tap\./.test(homeSource)
    && !/Smart Glance|Active Mode|One-tap chains|Memory pressure|System detail|Edit Home/.test(homeSource),
  "Home must use direct, everyday labels instead of technical dashboard terminology"
);
assert(/function renderOriginStatus\(\)[\s\S]*?bridgeSetup\.needsAttention[\s\S]*?"Needs Setup"/.test(dashboard), "top-level dashboard status must expose setup attention instead of claiming Ready");
assert(/function handleScrollCapture\(event\)\s*\{\s*if \(!activeTouch\)\s*\{\s*return;/.test(widgetCore), "non-touch and programmatic scrolling must not suppress the next click");
assert(/sessionControlLabel = getAudioSessionLabel\(session\) \+ " " \+ \(sessionIndex \+ 1\)/.test(audio), "audio session controls must receive privacy-safe unique row labels");
assert(/aria-label="' \+ escapeHtml\(\(session\.muted \? "Unmute " : "Mute "\) \+ sessionControlLabel\)/.test(audio) && /escapeHtml\(sessionControlLabel \+ " volume"\)/.test(audio), "audio mute and volume controls must expose unique accessible names");
assert(/\/api\/audio\/equalizer\/connect/.test(audio) && /\/api\/audio\/equalizer/.test(audio), "Audio & Media must connect and control the real Equalizer APO service");
assert(/equalizer\.installed[\s\S]*?equalizer\.connected[\s\S]*?equalizer\.bypassed/.test(audio), "Audio & Media must distinguish missing, disconnected, and bypassed equalizer states");
assert(/prevent distortion/.test(audio) && /min="-12" max="12" step="0\.5"/.test(audio), "equalizer controls must expose bounded gain and plain-language distortion protection");
assert(/\.audio-command-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(310px, 0\.68fr\) minmax\(700px, 1\.75fr\) minmax\(430px, 1fr\)[\s\S]*?grid-template-areas:\s*"output playback equalizer"/.test(audioCss), "wide Audio & Media must place playback in the largest center column");
assert(/\.audio-playback-card \.audio-album-card,[\s\S]*?width:\s*340px;[\s\S]*?height:\s*340px/.test(audioCss), "Audio & Media must keep the album cover large and central");
assert(/@media \(min-width:\s*1501px\) and \(min-height:\s*521px\) and \(max-height:\s*760px\)[\s\S]*?\.audio-master-card,[\s\S]*?\.audio-playback-card\s*\{[\s\S]*?padding-block:\s*14px/.test(audioCss), "short-wide Audio & Media sizing must stay compact without overriding the layout at 520px and below");
assert(/@media \(max-height:\s*520px\)[\s\S]*?\.audio-playback-card \.audio-media-now\s*\{[\s\S]*?align-items:\s*start;[\s\S]*?\.audio-playback-card \.audio-album-carousel__track,[\s\S]*?height:\s*126px;[\s\S]*?\.audio-playback-card \.audio-album-card,[\s\S]*?width:\s*108px;[\s\S]*?height:\s*108px/.test(audioCss), "very short Audio & Media layouts must keep the album cover compact and top-aligned with selectors strong enough to override the default playback card");
assert(/@media \(min-width:\s*2000px\) and \(min-height:\s*663px\) and \(max-height:\s*760px\)[\s\S]*?--audio-wide-album-size:\s*clamp\(372px,\s*calc\(100vh - 278px\),\s*420px\)[\s\S]*?height:\s*calc\(var\(--audio-wide-album-size\) \+ 16px\)[\s\S]*?width:\s*var\(--audio-wide-album-size\);[\s\S]*?height:\s*var\(--audio-wide-album-size\)/.test(audioCss), "wide Audio & Media layouts with enough height must scale album artwork to the available space without exceeding 420px");
assert(/\.audio-route-strip\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/.test(audioCss), "Audio outputs must use a compact two-column layout");
assert(/audio-equalizer-fine-tune[\s\S]*?Fine tune[\s\S]*?Advanced 10-band control[\s\S]*?equalizer\.bands\.map/.test(audio) && /\.audio-eq-bands\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/.test(audioCss) && /\.audio-eq-band input\[type="range"\][\s\S]*?writing-mode:\s*horizontal-tb/.test(audioCss), "advanced equalizer bands must stay available in a clear, horizontal Fine tune section");
assert(/audio-album-carousel__nav/.test(audio) && !/audio-album-card__caption/.test(audio), "album browsing must overlay the artwork without repeating track text");
assert(/Simple tone/.test(audio) && /Move left for less or right for more\./.test(audio) && /Center = unchanged/.test(audio), "the equalizer must explain its direction and neutral point in plain language");
assert(/Bass[\s\S]*?31–250 Hz[\s\S]*?Voices[\s\S]*?500 Hz–2 kHz[\s\S]*?Clarity[\s\S]*?4–8 kHz[\s\S]*?Highs[\s\S]*?16 kHz/.test(audio), "the equalizer must explain the audible frequency groups");
assert(/visibleSessions = activeSessions\.slice\(0, 2\)/.test(audio), "Audio & Media must use available space to expose both active app-volume controls");
assert(/Windows is sending sound here\./.test(audio) && /Control where sound plays, what is playing, app volumes, and tone\./.test(dashboard), "Audio & Media must use direct plain-language guidance");
assert(/@media \(min-width: 1501px\) and \(min-height: 521px\) and \(max-height: 760px\)/.test(audioCss), "Audio & Media must include a bounded short wide-display layout");
assert(/\.network-quality-score strong\s*\{[\s\S]*?color:\s*var\(--status-success-text\)/.test(networkCss) && /\.network-pill\[data-tone="good"\] strong\s*\{[\s\S]*?color:\s*var\(--status-success-text\)/.test(networkCss), "Network success values must use the contrast-checked semantic status color instead of an arbitrary custom accent");

assert(/reportWidgetError/.test(dashboard) && !/reportFatalDashboardError\(\s*"Inline widget/.test(dashboard), "panel errors must stay local");
for (const [name, source] of [["System", system], ["Network", network], ["Audio", audio]]) {
  assert(/patchStableDom\(container,/.test(source), `${name} refresh must patch stable DOM`);
  assert(!/container\.innerHTML\s*=\s*render/.test(source), `${name} refresh must not replace its live DOM`);
}
assert(!/Process\.GetProcesses|TopProcesses|SystemProcessSnapshot/.test(systemMetrics), "System telemetry must not enumerate or expose running applications");
assert(!/topProcesses|Top apps right now|What is using resources\?|PID /.test(system + standaloneSystem), "System Monitor must not render application or process identity");
assert(/Privacy-safe telemetry/.test(system) && /Open Task Manager when you need app-level detail/.test(system), "System Monitor must explain the privacy-safe replacement for process enumeration");
assert(/data-action="system-task-manager"/.test(system), "System Monitor must retain an explicit Task Manager handoff for app-level detail");
assert(/function patchStableDom/.test(inline), "shared stable DOM reconciler is required");
assert(/container\.innerHTML === nextContainer\.innerHTML/.test(inline), "unchanged polling samples must not mutate the mounted panel DOM");
assert(/function mountThemeStudioWidget[\s\S]*?patchStableDom\(container, productShell\(/.test(product), "Theme Studio must preserve its focused controls during redraws");
assert(/product-swatch[\s\S]*?role="radio"/.test(themeStudioSource) && !/select class="inline-select" name="themeId"/.test(themeStudioSource), "Theme Studio must expose one clear Theme selector instead of duplicate cards and dropdowns");
assert(/child\.parentNode === currentNode/.test(inline) && /nextContainer = container\.cloneNode\(false\)/.test(inline) && /reconcileStableNode\(container, nextContainer, activeNode\)/.test(inline), "stable DOM reconciliation must tolerate focus handlers and preserve multiple root children");
assert(/data-action/.test(inline) && /name:/.test(inline), "stable DOM reconciliation must key action and form controls across changing sibling content");
assert(/function dirtyFormControl/.test(inline) && /formControlStates\.forEach\(restoreFormControlState\)/.test(inline), "stable DOM reconciliation must preserve dirty form drafts after focus moves to an action control");
assert(/data-inline-widget-mount/.test(inline) && /mountRoot\.parentNode === container/.test(inline) && /container\.removeChild\(mountRoot\)/.test(inline), "each widget mount must own a disposable render root so late async callbacks cannot overwrite the next panel");
assert(/\.inline-widget-mount\s*\{[\s\S]*?display:\s*contents/.test(css), "isolated widget mount roots must preserve the existing visual layout");
for (const [name, source] of [["Actions", actions], ["Home integrations", homelab], ["Live integrations", integrations], ["Setup and Calendar", setup], ["Game Mode", gameMode]]) {
  assert(/var patchStableDom = runtime\.patchStableDom;/.test(source), `${name} renderers must use the shared stable DOM reconciler`);
  const nonCleanupSource = source.replace(/container\.innerHTML\s*=\s*""\s*;/g, "");
  assert(!/container\.innerHTML\s*=/.test(nonCleanupSource), `${name} redraws must not replace live or focused controls`);
}
assert(!/container\.innerHTML\s*=/.test(product), "product surfaces must never replace a live container through innerHTML");
assert((product.match(/patchStableDom\(container, productShell\(/g) || []).length >= 10, "Every interactive product renderer must preserve focused controls across redraws");
assert(/function patchDashboardDom/.test(dashboard) && /patchStableDom/.test(dashboard), "dynamic dashboard chrome must share stable DOM reconciliation");
assert(/function postJson\(url, body, timeoutMs, options\)[\s\S]*?headers\["X-Xenon-Session"\] = window\.XenonSessionToken/.test(dashboard), "dashboard background mutations must send the native session token explicitly");
assert(!/(?:pickerNode|launcherDockNode|scenesNode|inlineViewerNode|settingsNode)\.innerHTML\s*=/.test(dashboard), "picker, launcher dock, quick Modes, settings, and inline teardown must not replace focused DOM");
assert(!/template\.innerHTML\s*=/.test(dashboard + inline) && (dashboard.match(/createContextualFragment/g) || []).length >= 1 && (inline.match(/createContextualFragment/g) || []).length >= 1, "dashboard HTML parsing must stay detached from live innerHTML mutation");
assert(/settingsRenderInProgress[\s\S]*?function replaceSettingsMarkup[\s\S]*?patchDashboardDom\(settingsNode, html\)/.test(dashboard), "settings redraws must prevent focus-triggered reentrant DOM replacement");
assert(/function focusedFormControl\(\)[\s\S]*?function requestRedraw\(\)[\s\S]*?redrawPending = true/.test(themeStudioSource) && /addListener\(cleanups, container, "focusout"/.test(themeStudioSource), "Theme Studio must defer redraw until the focused form control has completed blur cleanup");
assert(/requestJson\(buildBridgeUrl\(env, "\/api\/provisioning"\)/.test(setup) && /state\.provisioning \|\| setup\.provisioning/.test(setup), "Diagnostics must obtain minimized launcher review data from the dedicated provisioning endpoint");
assert(/var finishSetupAction = essentialsReady && !onboardingCompleted[\s\S]*?data-action="finish-setup">Finish setup/.test(setup) && !/Auto ready|Finish manually/.test(setup), "Diagnostics must show setup completion only as a truthful actionable control");
assert(/<div class="eyebrow">Readiness overview<\/div>[\s\S]*?<h3 class="inline-title">System readiness<\/h3>/.test(setup), "Diagnostics must avoid repeating its page name inside the readiness overview");
assert(/<h1>Diagnostics<\/h1>/.test(standaloneSetup) && !/Auto setup & diagnostics|Auto ready/.test(standaloneSetup), "standalone Diagnostics must use the same stable name and omit the obsolete disabled completion control");
assert(/id="finish-setup-slot"/.test(standaloneSetup) && /finishSlot\.appendChild\(finishButton\)/.test(standaloneSetup), "standalone Diagnostics must render manual completion only when it is actionable");
assert(!/Copy embed|Copy URL|guide-iframe-snippet|dashboardUrl|renderSnippets|copyText/.test(standaloneSetup), "standalone Diagnostics must not expose developer embed controls or a self-referential display URL");
assert(/params\.get\("endpoint"\) \|\| "\/api\/calendar"/.test(standaloneCalendar) && !/Sprint standup|Design sync|Benchmarks|Publish to GitHub Pages/.test(standaloneCalendar), "standalone Calendar must use the native calendar service and never present fake sample meetings");
assert(/params\.get\("endpoint"\) \|\| "\/api\/network"/.test(standaloneNetwork), "standalone Network must use the native network service by default");
assert(/params\.get\("endpoint"\) \|\| "\/api\/system"/.test(standaloneSystem) && /params\.get\("gpuPowerEndpoint"\) \|\| "\/api\/gpu-power"/.test(standaloneSystem), "standalone System Monitor must use native system and GPU telemetry by default");
assert(!/current\.deviceType \|\| current\.id/.test(standaloneAudio) && /label\(current\.deviceType, "Windows default device"\)/.test(standaloneAudio), "standalone Audio must never expose a raw Windows device identifier as user-facing copy");
assert(/\.action-button\s*\{\s*min-height:\s*44px;/.test(standaloneHue), "standalone Hue actions must meet the 44px touch-target minimum");
assert(/\.action-button:focus-visible,[\s\S]*?\.toggle-button:focus-visible[\s\S]*?outline:\s*3px solid #7defff/.test(standaloneHue), "standalone Hue controls must retain a 3px keyboard focus indicator");
assert(/\.field input:focus-visible,[\s\S]*?\.field select:focus-visible[\s\S]*?outline:\s*3px solid #7defff/.test(standaloneSetup), "standalone Diagnostics fields must retain a 3px keyboard focus indicator");
assert(/id="volume"[^>]*aria-label="Master volume"/.test(standaloneAudio), "standalone Audio master-volume slider must expose an accessible name");
assert(/\.dashboard-native-page--adaptive \.audio-media-controls \.inline-button\s*\{[\s\S]*?font-size:\s*max\(15px,\s*0\.9rem\)/.test(audioStyles), "wide Audio transport controls must retain 15px distance-readable labels");
assert(/data-action="brightness"[^>]*aria-label="Light brightness for ' \+ escapeHtml\(light\.name\)/.test(standaloneAutomation), "standalone Home Automation brightness sliders must include the light name");
assert(/data-action="brightness-light"[^>]*aria-label="Light brightness for ' \+ escapeHtml\(light\.name\)/.test(standaloneHue)
  && /data-action="brightness-group"[^>]*aria-label="Room brightness for ' \+ escapeHtml\(group\.name\)/.test(standaloneHue), "standalone Hue brightness sliders must include the light or room name");
assert(/id="download-detail"[^>]*>Live throughput<\/div>/.test(standaloneNetwork)
  && /estimated:\s*Boolean\(connection\)/.test(standaloneNetwork)
  && /download:\s*downlink === null \? null : downlink \* 1000 \* 1000 \/ 8/.test(standaloneNetwork)
  && /snapshot\.estimated \? "Browser connection estimate"/.test(standaloneNetwork)
  && /snapshot\.estimated \? "Not reported by browser"/.test(standaloneNetwork), "standalone Network must distinguish browser connection estimates from live throughput");
for (const [name, source] of [["Home Automation", standaloneAutomation], ["NAS", standaloneNas], ["Plex", standalonePlex]]) {
  assert(/html\[data-size="large"\][\s\S]*?overflow-y:\s*auto/.test(source)
    && /\[data-size="large"\] body,[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible/.test(source)
    && /\[data-size="large"\] \.widget,[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*calc\(100vh - 20px\)/.test(source)
    && /\[data-size="large"\] \.layout,[\s\S]*?height:\s*auto/.test(source), `${name} responsive standalone layout must grow and remain vertically scrollable`);
}
assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.toggle-button,[\s\S]*?\.scene-button[\s\S]*?transition:\s*none/.test(standaloneAutomation), "standalone Home Automation controls must honor reduced motion");
for (const [name, source] of [["Calendar", standaloneCalendar], ["System Monitor", standaloneSystem], ["Weather", standaloneWeather]]) {
  assert(!/fonts\.googleapis|fonts\.gstatic/.test(source), `${name} standalone fallback must not depend on CSP-blocked remote fonts`);
}
assert(/button\.onclick = function \(\)/.test(dashboard), "stable picker buttons must replace click handlers instead of accumulating listeners");
assert(/function publishSurfaceStatus\(widgetId, status, tone, detail\)/.test(dashboard)
  && /updatePickerSurfaceStatus\(widgetId\)/.test(dashboard)
  && !/surfaceStatuses\.updates\s*=/.test(dashboard), "background surface status must update only its picker label instead of reconciling the whole selector");
assert(/function buildInlineWidgetEnv\(widget, generation\)/.test(dashboard)
  && /widgetErrorGeneration !== generation \|\| currentWidgetId !== widgetId/.test(dashboard)
  && /reportWidgetError\(widget, error, phase \|\| "updating", generation\)/.test(dashboard), "inline status and error callbacks must remain owned by the widget generation that created them");
assert(/nowStripMode === "hidden"/.test(dashboard) && /playbackStatus/.test(dashboard) && /data-now-strip-action="dismiss"/.test(html), "media strip must support active-only Auto and persistent dismissal");
assert(/nowStripRenderSignature/.test(dashboard) && /nowStripRenderSignature === nextSignature/.test(dashboard), "unchanged media-strip samples must not rewrite visible text every polling interval");
assert(/hydrated:\s*false/.test(dashboard) && /getWidgetState[\s\S]*?"Checking"/.test(dashboard), "cold boot must remain neutral until health hydration");

assert(/statusText:\s*"Not checked"/.test(product) && /env\.publishStatus/.test(product), "Updates must publish a truthful unchecked status");
assert(/"display-controls": \{ destination: "library", category: "System", defaultStatus: "Available"/.test(dashboard), "Display Controls rail must stay truthfully Available until the user opens the panel and native capability discovery finishes");
assert(/function publishControlStatus/.test(product) && /Windows primary display is excluded/.test(product), "Display Controls must publish terminal status and explain its companion-only scope");
assert(/aria-label="Input source code for /.test(product) && /Confirm turning off /.test(product), "Display Controls must uniquely name monitor-specific input and power controls");
assert(/var checking = !!activeRequest \|\| state\.payload === null \|\| isPending\(state\.payload\)/.test(product) && /payload\.status === "pending"/.test(product) && /Checking companion controls/.test(product), "Display Controls must show a truthful loading state both before and during DDC\/CI discovery");
assert(/"Release checks"/.test(product) && /does not install updates automatically/.test(product) && !/Auto-update foundation/.test(product), "Updates must describe release checking without claiming automatic installation");
assert(/Automatic rollback is not included in this beta/.test(product) && /Manual rollback only/.test(product) && !/data-action="check-rollback"/.test(product), "Updates must not advertise an automatic rollback action that this beta cannot perform");
for (const [name, source] of [["app config", appConfig], ["config normalization", configStore], ["config API", configController], ["display selection", bridgeManager], ["support API", supportController], ["dashboard defaults", dashboard]]) {
  assert(!/UpdateRollbackEnabled|updateRollbackEnabled|LastKnownGood|lastKnownGood|RollbackEnabled|rollbackEnabled/.test(source), `${name} must not retain unusable automatic-rollback metadata`);
}
assert(/limited to channels supported by this build/.test(dashboard) && !/Stable, beta, and nightly release checks/.test(dashboard), "beta UI copy must not advertise an unavailable Stable channel");
assert(/env\.publishStatus\("Unavailable"/.test(product), "Phone Remote must publish Unavailable");
assert(/streaming:\s*\{ destination: "settings", category: "Creator", defaultStatus: "Preview"/.test(dashboard), "Streaming must be presented as a preview instead of an available command surface");
assert(/normalizeLocalObsEndpoint/.test(product) && /host === "localhost"/.test(product) && /host === "127\.0\.0\.1"/.test(product) && /Local address required/.test(product), "Streaming probes must fail closed outside explicit loopback OBS endpoints");
assert(/env\.publishStatus\("Preview", "warn"/.test(product) && /does not issue OBS commands/.test(product + dashboard), "Streaming must publish its commandless preview limitation");
assert(/Save &amp; check OBS/.test(product) && /addListener\(cleanups, container, "submit"/.test(product) && /probeObs\(endpoint\)/.test(product), "Streaming must validate, save, and probe the visible OBS endpoint in one explicit form action");
assert(!/data-action="probe-obs"/.test(product), "Streaming must not retain the blur-racy standalone probe action");
assert(/portableDashboardSettingKeys/.test(product) && /"layoutOrder"/.test(product) && /"modeLayouts"/.test(product) && /"cardSizes"/.test(product), "Privacy backup must include local layout and Mode presentation settings");
assert(/buildPortableDashboardSettings/.test(product) && /gameModeAutoTune:\s*settings\.gameModeAutoTune !== "0"/.test(product), "Privacy backup must preserve native value types while adding local presentation settings");
assert(/localDashboardSettings = readPortableDashboardSettings\(settings\);[\s\S]{0,300}requestJson\(buildBridgeUrl\(env, "\/api\/config\/backup"\)/.test(product), "Privacy restore must validate client presentation fields before changing native configuration");
assert(/var statusGeneration = 0/.test(product) && /setStatusIfCurrent\(generation, "Diagnostics refreshed"/.test(product) && /setStatus\("Restoring backup", "warn"\)/.test(product), "Privacy background refresh must not overwrite a newer backup, restore, reset, or tracking result");
assert(/reloadLocalSettings: kind === "local-settings",\s*skipFrameReload: kind === "local-settings"/.test(dashboard), "Privacy restore must refresh native and local state without remounting away its completion status");
assert(/data-media-metadata/.test(product) && /data-audio-session-labels/.test(product) && /off by default/.test(product), "Privacy must expose explicit opt-in controls for media details and audio application labels");
assert(/field = "mediaMetadataVisible"/.test(product) && /field = "audioSessionLabelsVisible"/.test(product) && /body: payload/.test(product), "Media privacy toggles must persist through the native dashboard configuration API");
assert(/scene\.id !== "scene-night"/.test(product) && /scene\.id !== "scene-night"/.test(dashboard), "Night must not render as a Mode");
assert(/ThemeVariant = config\.Scenes\.ThemeVariant/.test(sceneService) || !/config\.Scenes\.ThemeVariant = "standard";[\s\S]{0,120}Automatic switching resumed/.test(sceneService), "resuming Mode automation must preserve Night");
assert(/SetDisplayAssignment[\s\S]*?string\.IsNullOrWhiteSpace\(normalizedSceneId\)[\s\S]*?RemoveAll/.test(sceneService), "empty sceneId must support display unassignment");
assert(/manualOverrideActive/.test(sceneService) && /automaticSwitchingActive/.test(sceneService), "Mode snapshot must expose truthful automation state");
assert(/scene-night/.test(sceneDefaults), "legacy Night schedule carrier must remain migration-compatible");

assert(!/<h3 class="inline-title">' \+ escapeHtml\(title\)/.test(inline), "product panels must not duplicate the outer surface heading");
assert(/friendlySurfaceNames/.test(product) && /Automatic switching is on/.test(product), "Modes must use customer-facing names and automation copy");
assert(/scene\.animationIntensity == null \? 25 : scene\.animationIntensity/.test(product) && /% motion/.test(product) && !/% brightness/.test(product), "Modes must display applied motion intensity instead of an unused brightness claim");
assert(/healthTargetSource/.test(product) && /home network is working/.test(product) && /internet connection is working/.test(product), "Home must describe the actual Network health target in everyday language instead of treating every ping as general internet latency");
assert(/function mountAuxoraHomeWidget[\s\S]*?function refresh\(\) \{\s*return Promise\.all/.test(product), "Home background refresh must retain its current sample instead of flashing a loading state");
assert(!/Customer recovery|customer actions|look customers see first/.test(product + dashboard), "installed UI copy must speak to the user instead of describing customers or internal product work");
assert(/CLIENT_CONFIRMATION_WINDOW_MS = 8000/.test(actions) && (actions.match(/function armConfirmation\(actionId\)/g) || []).length === 2 && /Tap again within 8 seconds to run/.test(actions) && /requiresConfirmation \? "Two-step"/.test(actions), "Quick Actions and System Shortcuts must use truthful, expiring two-step confirmation states");
assert(/RESET_CONFIRMATION_WINDOW_MS = 8000/.test(setup) && /function armResetConfirmation\(\)/.test(setup) && /Tap again within 8 seconds/.test(setup) && /action !== "reset-local-data" && state\.confirmReset[\s\S]*?Reset cancelled[\s\S]*?redraw\(\)/.test(setup) && /clearTimeout\(resetConfirmationTimerId\)/.test(setup), "Diagnostics local-data reset must use an expiring teardown-safe two-step confirmation and immediately clear its visible armed state when another control is used");
assert(/Move " \+ row\.title \+ " earlier/.test(product) && /aria-label="Width for /.test(product) && /aria-label="Where /.test(product), "Layout Editor order, placement, and width controls must name the panel they affect");
assert(/function activeMode\(\)/.test(product) && /Changes save automatically/.test(product) && /data-layout-live/.test(product), "Layout Editor must name the active Mode and announce automatically saved changes");
assert(/data-ui-key="layout-row-/.test(product) && /data-ui-key="layout-earlier-/.test(product) && /data-ui-key="layout-width-/.test(product), "Layout Editor rows and controls must keep stable identities while reordering");
assert(/configured:\s*isWidgetConfigured\(widget\.id\)/.test(dashboard) && /Home after setup/.test(product) && /Hidden in this Mode/.test(product), "Layout Editor placement must describe actual Home availability and the current-Mode visibility scope");
assert(/data-layout-placement/.test(product) && /Library only/.test(product) && /pinnedWidgets:\s*pinnedWidgets\.join/.test(product) && /hiddenWidgets:\s*hiddenWidgets\.join/.test(product), "Layout Editor placement must directly choose Home, Library-only, or Hidden and save pin and visibility together");
assert(/modeLayoutSchemaVersion:\s*"2"/.test(dashboard) && /function migrateLegacyModeLayouts\(activeModeId\)/.test(dashboard) && /Object\.assign\(\{\}, legacyLayout, modeLayout\)/.test(dashboard) && /String\(storedSettings\.modeLayoutSchemaVersion \|\| ""\) === "2"/.test(dashboard), "Mode layouts must preserve every missing legacy field during one-time migration, then keep each Mode isolated");
assert(/layoutChanged && !importsLayoutSnapshot[\s\S]{0,160}migrateLegacyModeLayouts\(activeModeId\)[\s\S]{0,360}importsLayoutSnapshot && \(layoutChanged \|\| modeLayoutsChanged\)[\s\S]{0,160}migrateLegacyModeLayouts\(activeModeId\)/.test(dashboard), "Normal pre-hydration edits must migrate old layout values before saving, while imported backups migrate from their imported snapshot");
assert(/"modeLayouts", "modeLayoutSchemaVersion", "marketplacePack"/.test(product) && /settings\.modeLayoutSchemaVersion = "1"/.test(product), "Layout backup and restore must preserve the Mode-layout migration version and safely recognize older backups");
assert(/data-layout-size/.test(product) && /value="compact"/.test(product) && />Narrow</.test(product) && />Regular</.test(product) && />Full</.test(product), "Layout Editor width must use direct plain-language choices instead of a cycling size button");
assert(/scene\.name \+ " Mode active"/.test(product) && /"Duplicate " \+ scene\.name \+ " Mode"/.test(product), "Mode controls must expose unique scene-specific accessible names");
assert(/data-scene-edit/.test(product) && /data-scene-delete/.test(product) && /Custom Mode saved/.test(product), "duplicated Modes must be editable, saveable, and removable from the production UI");
assert(/confirmDeleteId/.test(product) && /Confirm delete/.test(product) && /8000/.test(product), "custom Mode deletion must use a bounded two-step confirmation");
assert(/data-recovery-confirm/.test(product) && /data-recovery-cancel/.test(product) && /confirmations/.test(product), "disruptive Recovery actions must require explicit confirmation");
assert(/statusDetail:\s*"Checking recovery actions"/.test(product) && /env\.publishStatus\(state\.statusText, state\.statusTone, state\.statusDetail\)/.test(product) && /payload && payload\.status === "ready" \? "Ready" : "Waiting for display"/.test(product), "Recovery must publish a terminal Ready or waiting state instead of staying Checking");
assert(/function maybeCheckRecoveryAvailability\(\)/.test(dashboard) && /fetchJson\(buildUrl\(bridgeOrigin, "\/api\/recovery"\), 7000\)/.test(dashboard) && /maybeCheckForAvailableUpdate\(\);\s*maybeCheckRecoveryAvailability\(\)/.test(dashboard), "Recovery must resolve its rail status after bridge hydration without requiring the user to open the panel");
assert(/"display-controls": \{ destination: "library", category: "System", defaultStatus: "Available" \}/.test(dashboard) && !/function maybeCheckDisplayControlsAvailability\(\)/.test(dashboard), "Display Controls must use a truthful terminal Available rail state without running an expensive DDC\/CI probe on every dashboard boot");
assert(/inline-grid inline-grid--3 setup-optional-grid/.test(setup) && /\.setup-optional-grid\s*\{[\s\S]*?align-items:\s*start;/.test(css), "Diagnostics optional integration cards must keep their natural height instead of stretching short cards into opaque empty panels");
assert(/<ol class="product-layout-list"/.test(product) && /--layout-column-rows/.test(product) && /grid-auto-flow:\s*column/.test(productCss) && /grid-template-rows:\s*repeat\(var\(--layout-column-rows\)/.test(productCss), "Layout Editor must expose one numbered order whose wide-screen visual flow matches Earlier and Later");
assert(/product-layout-row__handle" draggable="true"/.test(product) && !/<li class="product-layout-row[^\n]*draggable="true"/.test(product), "Layout Editor dragging must start from the visible handle instead of the entire control-filled row");
assert(/game-mode-idle-grid[\s\S]*?grid-template-rows:\s*none;[\s\S]*?grid-auto-rows:\s*max-content/.test(gameCss), "Game Mode idle layout must use natural vertical rows");
assert(/game-mode-steam-dock[\s\S]*?overflow-x:\s*auto/.test(gameCss), "Steam dock must retain intentional horizontal scrolling");

// Execute the actual Home mount with a fake clock and event propagation. These
// gesture regressions do not start a browser, host, or device-facing request.
function homeGestureHarness(source = homeSource) {
  let clock = 0;
  let nextTimer = 0;
  const timers = new Map();
  const selections = [];
  const targets = [];
  const target = (parentElement = null, control = "") => {
    const node = {
      parentElement, control, isConnected: true, scrollTop: 0, scrollLeft: 0,
      listeners: new Map(),
      contains(other) { for (let current = other; current; current = current.parentElement) if (current === this) return true; return false; },
      closest(selector) { for (let current = this; current; current = current.parentElement) if (current.control && selector.split(",").includes(current.control)) return current; return null; },
      addEventListener(type, handler, options = false) {
        const capture = options === true || Boolean(options && options.capture);
        const handlers = this.listeners.get(type) || [];
        if (!handlers.some(entry => entry.handler === handler && entry.capture === capture)) handlers.push({ handler, capture, once: Boolean(options && options.once), passive: Boolean(options && options.passive) });
        this.listeners.set(type, handlers);
      },
      removeEventListener(type, handler, options = false) {
        const capture = options === true || Boolean(options && options.capture);
        this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.handler !== handler || entry.capture !== capture));
      }
    };
    targets.push(node);
    return node;
  };
  const document = target();
  document.hidden = false;
  const scroller = target(document);
  const container = target(scroller);
  const content = target(container);
  const outside = target(document);
  const window = target();
  window.setTimeout = (handler, milliseconds) => { const id = ++nextTimer; timers.set(id, { handler, due: clock + milliseconds }); return id; };
  window.clearTimeout = id => timers.delete(id);
  const mount = runInNewContext(`(${source})`, {
    window, document,
    addListener(cleanups, node, type, handler, options) { node.addEventListener(type, handler, options); cleanups.push(() => node.removeEventListener(type, handler, options)); },
    runCleanups: cleanups => cleanups.splice(0).forEach(cleanup => cleanup()),
    patchStableDom() {}, productShell: () => "", metricCard: () => "", escapeHtml: value => value,
    text: (value, fallback) => value == null || value === "" ? fallback : String(value),
    buildBridgeUrl: (env, path) => path,
    requestJson: () => new Promise(() => {})
  });
  const instance = mount({ id: "home" }, container, { selectWidget: (id, persist) => selections.push({ id, persist }) });
  return {
    document, window, scroller, container, content, outside, target, selections, instance, timers,
    listenerCount: () => targets.reduce((count, node) => count + [...node.listeners.values()].reduce((sum, handlers) => sum + handlers.length, 0), 0),
    emit(type, properties = {}, eventTarget = content) {
      let stopped = false;
      let immediatelyStopped = false;
      const event = {
        type, target: eventTarget, currentTarget: null, eventPhase: 0, bubbles: !["scroll", "blur"].includes(type),
        pointerId: 1, pointerType: "touch", button: 0, buttons: 1, isPrimary: true, clientX: 100, clientY: 100,
        preventDefault() { throw new Error("Home gesture must not block native scrolling"); },
        stopPropagation() { stopped = true; },
        stopImmediatePropagation() { stopped = true; immediatelyStopped = true; },
        ...properties
      };
      const path = [];
      for (let node = eventTarget; node; node = node.parentElement) path.unshift(node);
      if (path[0] === document) path.unshift(window);
      const invoke = (node, capture, phase) => {
        event.currentTarget = node; event.eventPhase = phase;
        for (const entry of [...(node.listeners.get(type) || [])]) {
          if (entry.capture !== capture || !(node.listeners.get(type) || []).includes(entry)) continue;
          if (entry.once) node.removeEventListener(type, entry.handler, entry.capture);
          entry.handler(event);
          if (immediatelyStopped) break;
        }
      };
      const ancestors = path.slice(0, -1);
      for (const node of ancestors) { invoke(node, true, 1); if (stopped) break; }
      if (!stopped) {
        invoke(eventTarget, true, 2);
        if (!immediatelyStopped) invoke(eventTarget, false, 2);
        if (event.bubbles && !stopped) for (const node of ancestors.reverse()) { invoke(node, false, 3); if (stopped) break; }
      }
      event.currentTarget = null; event.eventPhase = 0;
    },
    advance(milliseconds) {
      const until = clock + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); clock = next[1].due; next[1].handler();
      }
      clock = until;
    }
  };
}

function checkHomeLongPress() {
  let checks = 0;
  const check = (condition, message) => { assert(condition, `Home long press: ${message}`); checks += 1; };
  const propagation = homeGestureHarness();
  const order = [];
  const registrations = [];
  for (const [name, node] of [["window", propagation.window], ["document", propagation.document], ["container", propagation.container], ["content", propagation.content]]) {
    for (const capture of [false, true]) {
      const handler = event => order.push(`${name}-${capture ? "capture" : "bubble"}-${event.eventPhase}`);
      node.addEventListener("gesture-test", handler, { capture });
      registrations.push({ node, handler, capture });
    }
  }
  propagation.emit("gesture-test");
  check(order.join(",") === "window-capture-1,document-capture-1,container-capture-1,content-capture-2,content-bubble-2,container-bubble-3,document-bubble-3,window-bubble-3", "test dispatcher must use capture, target, and bubble order regardless of registration order");
  order.length = 0;
  propagation.emit("gesture-test", { bubbles: false });
  check(order.join(",") === "window-capture-1,document-capture-1,container-capture-1,content-capture-2,content-bubble-2", "non-bubbling events must still reach ancestor capture and both target phases");
  for (const { node, handler, capture } of registrations) node.removeEventListener("gesture-test", handler, capture);
  let captured = 0;
  const captureHandler = () => { captured += 1; };
  propagation.document.addEventListener("capture-cleanup-test", captureHandler, true);
  propagation.document.removeEventListener("capture-cleanup-test", captureHandler, false);
  propagation.emit("capture-cleanup-test");
  check(captured === 1, "listener removal with the wrong capture flag must not remove a capture listener");
  propagation.document.removeEventListener("capture-cleanup-test", captureHandler, { capture: true });
  propagation.emit("capture-cleanup-test");
  check(captured === 1, "matching capture-aware cleanup must remove the listener");
  propagation.instance.destroy();
  check(propagation.listenerCount() === 0, "all mounted capture and bubble listeners must be removed on destroy");
  const missingCaptureSource = homeSource.replace(/(addListener\(cleanups, document, "pointerdown", function \(event\) \{[\s\S]*?\}, \{ )capture: true(, passive: true \}\);)/, "$1capture: false$2");
  check(missingCaptureSource !== homeSource, "capture regression mutation must alter the real document pointerdown listener");
  const missingCapture = homeGestureHarness(missingCaptureSource);
  missingCapture.emit("pointerdown"); missingCapture.advance(700);
  check(missingCapture.selections.length === 0, "removing document capture must reproduce the ordering bug that the real-hold checks reject");
  missingCapture.instance.destroy();
  const jitter = homeGestureHarness();
  jitter.emit("pointerdown"); jitter.advance(200);
  jitter.emit("pointermove", { clientX: 103, clientY: 104 }); jitter.advance(499);
  check(jitter.selections.length === 0, "must wait the full 700ms hold");
  jitter.advance(1);
  check(jitter.selections.length === 1 && jitter.selections[0].id === "layout-editor" && jitter.selections[0].persist, "small stationary finger jitter must still open Customize Home after 700ms");
  jitter.advance(1400);
  check(jitter.selections.length === 1, "a held pointer must open only once");
  jitter.instance.destroy();

  for (const [name, x, y, opens] of [["stationary", 100, 100, true], ["six-pixel boundary", 106, 100, true], ["scroll intent", 100, 107, false], ["horizontal movement", 107, 100, false], ["diagonal movement", 105, 105, false]]) {
    const fixture = homeGestureHarness(); fixture.emit("pointerdown");
    fixture.emit("pointermove", { clientX: x, clientY: y }); fixture.advance(700);
    check(fixture.selections.length === Number(opens), `${name} must ${opens ? "allow" : "cancel"} the hold`); fixture.instance.destroy();
  }
  const drift = homeGestureHarness(); drift.emit("pointerdown");
  for (const x of [103, 105, 107, 100]) { drift.advance(100); drift.emit("pointermove", { clientX: x }); }
  drift.advance(700);
  check(drift.selections.length === 0, "movement is measured from the original touch, and returning must not rearm it"); drift.instance.destroy();

  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    const fixture = homeGestureHarness(); fixture.emit("pointerdown"); fixture.advance(600);
    fixture.emit(type, {}, fixture.outside); fixture.advance(700);
    check(fixture.selections.length === 0, `${type} outside Home must cancel the matching pointer`); fixture.instance.destroy();
  }
  const identity = homeGestureHarness(); identity.emit("pointerdown");
  identity.emit("pointermove", { pointerId: 9, clientX: 200 }, identity.outside);
  identity.emit("pointerup", { pointerId: 9 }, identity.outside); identity.advance(700);
  check(identity.selections.length === 1, "unrelated pointer movement/end must not cancel the active pointer"); identity.instance.destroy();

  for (const pointerType of ["mouse", "pen"]) {
    for (const buttons of [3, 2, 0, 5]) {
      const fixture = homeGestureHarness(); fixture.emit("pointerdown", { pointerType }); fixture.advance(400);
      fixture.emit("pointermove", { pointerType, button: -1, buttons }); fixture.advance(700);
      check(fixture.selections.length === 0, `${pointerType} buttons=${buttons} must cancel a chord or lost primary contact`); fixture.instance.destroy();
    }
    const fixture = homeGestureHarness(); fixture.emit("pointerdown", { pointerType });
    fixture.emit("pointermove", { pointerType, button: -1, buttons: 1, clientX: 103 }); fixture.advance(700);
    check(fixture.selections.length === 1, `${pointerType} primary-button jitter must still allow a hold`); fixture.instance.destroy();
  }
  const chord = homeGestureHarness(); chord.emit("pointerdown", { pointerType: "mouse" }); chord.advance(200);
  chord.emit("pointermove", { pointerType: "mouse", button: 2, buttons: 3 }); chord.advance(200);
  chord.emit("pointermove", { pointerType: "mouse", button: 0, buttons: 2 }); chord.advance(700);
  check(chord.selections.length === 0, "left down, right down, then left up must cancel even without a second pointerdown or pointerup"); chord.instance.destroy();
  const released = homeGestureHarness(); released.emit("pointerdown", { pointerType: "mouse" });
  released.emit("pointermove", { pointerType: "mouse", button: -1, buttons: 0 });
  released.emit("pointerdown", { pointerId: 2, pointerType: "touch" }); released.advance(700);
  check(released.selections.length === 1, "a fully released mouse must not remain a phantom contact that blocks the next touch"); released.instance.destroy();
  for (const pointerType of ["mouse", "pen"]) {
    const fixture = homeGestureHarness();
    const capturedNode = fixture.target(fixture.container);
    fixture.emit("pointerdown", {}, capturedNode);
    capturedNode.isConnected = false; capturedNode.parentElement = null;
    fixture.emit("lostpointercapture", {}, fixture.document);
    fixture.emit("pointerdown", { pointerId: 2, pointerType }); fixture.advance(700);
    check(fixture.selections.length === 0, `lost capture after node replacement must not forget a held touch and arm a new ${pointerType} hold`);
    fixture.emit("pointerup", { pointerId: 2, pointerType }); fixture.emit("pointerup");
    fixture.emit("pointerdown", { pointerId: 2, pointerType }); fixture.advance(700);
    check(fixture.selections.length === 1, `${pointerType} must work normally once both contacts have actually ended`); fixture.instance.destroy();
  }

  for (const properties of [{ button: 2 }, { button: 1 }, { isPrimary: false }, { pointerType: "mouse", buttons: 3 }, { pointerType: "pen", buttons: 2 }]) {
    const fixture = homeGestureHarness(); fixture.emit("pointerdown", properties); fixture.advance(700);
    check(fixture.selections.length === 0, "secondary buttons and nonprimary contacts must not start a hold"); fixture.instance.destroy();
  }
  for (const control of ["button", "a", "input", "select", "textarea", "summary", "[role='button']", "[contenteditable]"]) {
    const fixture = homeGestureHarness(); const child = fixture.target(fixture.target(fixture.container, control));
    fixture.emit("pointerdown", {}, child); fixture.advance(700);
    check(fixture.selections.length === 0, `holding inside ${control} must keep its normal interaction`); fixture.instance.destroy();
  }
  for (const second of [{ pointerId: 2, isPrimary: false }, { pointerId: 2, pointerType: "mouse", isPrimary: true }]) {
    for (const relation of ["outside", "content"]) {
      const fixture = homeGestureHarness(); fixture.emit("pointerdown"); fixture.advance(400);
      fixture.emit("pointerdown", second, fixture[relation]); fixture.emit("pointerup", second, fixture[relation]); fixture.advance(700);
      check(fixture.selections.length === 0, "another contact must cancel without restarting the original hold");
      fixture.emit("pointerup"); fixture.emit("pointerdown"); fixture.advance(700);
      check(fixture.selections.length === 1, "a fresh single-finger hold must work after multitouch ends"); fixture.instance.destroy();
    }
  }
  for (const type of ["scroll", "wheel"]) {
    for (const relation of ["scroller", "content"]) {
      const fixture = homeGestureHarness(); fixture.emit("pointerdown"); fixture.emit(type, {}, fixture[relation]); fixture.advance(700);
      check(fixture.selections.length === 0, `${type} on a related ${relation} must cancel`); fixture.instance.destroy();
    }
    const fixture = homeGestureHarness(); fixture.emit("pointerdown"); fixture.emit(type, {}, fixture.outside); fixture.advance(700);
    check(fixture.selections.length === 1, `unrelated ${type} must not cancel`); fixture.instance.destroy();
  }
  const scrolled = homeGestureHarness(); scrolled.emit("pointerdown"); scrolled.scroller.scrollTop = 1; scrolled.advance(700);
  check(scrolled.selections.length === 0, "actual scroll position changes must cancel even before their scroll event arrives"); scrolled.instance.destroy();
  for (const cause of ["blur", "hidden", "detached", "inert", "destroy"]) {
    const fixture = homeGestureHarness(); fixture.emit("pointerdown");
    if (cause === "blur") fixture.emit("blur", {}, fixture.window);
    if (cause === "hidden") { fixture.document.hidden = true; fixture.emit("visibilitychange", {}, fixture.document); }
    if (cause === "detached") fixture.container.isConnected = false;
    if (cause === "inert") fixture.scroller.control = "[inert]";
    if (cause === "destroy") fixture.instance.destroy();
    fixture.advance(700);
    check(fixture.selections.length === 0, `${cause} must not leave a delayed navigation`);
    if (cause !== "destroy") fixture.instance.destroy();
    check(fixture.timers.size === 0 && fixture.listenerCount() === 0, `${cause} cleanup must remove all gesture listeners and timers`);
  }
  console.log(`checked ${checks} deterministic Home long-press assertions`);
}

checkHomeLongPress();
await import("./check-display-controls.mjs");
console.log("checked exhaustive Auxora UI remediation contracts");
