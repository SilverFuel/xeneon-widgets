using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Xeneon.Audio
{
    public enum EDataFlow
    {
        eRender,
        eCapture,
        eAll,
        EDataFlow_enum_count
    }

    public enum ERole
    {
        eConsole,
        eMultimedia,
        eCommunications,
        ERole_enum_count
    }

    [Flags]
    public enum DeviceState : uint
    {
        Active = 0x00000001,
        Disabled = 0x00000002,
        NotPresent = 0x00000004,
        Unplugged = 0x00000008,
        MaskAll = 0x0000000F
    }

    public enum AudioSessionState
    {
        Inactive = 0,
        Active = 1,
        Expired = 2
    }

    public sealed class RenderDeviceRecord
    {
        public RenderDeviceRecord()
        {
            Id = "";
            Name = "";
            State = "Unknown";
        }

        public string Id { get; set; }
        public string Name { get; set; }
        public string State { get; set; }
        public bool IsDefault { get; set; }
    }

    public sealed class AudioSessionRecord
    {
        public AudioSessionRecord()
        {
            Identifier = "";
            DisplayName = "";
            State = "Inactive";
        }

        public string Identifier { get; set; }
        public uint ProcessId { get; set; }
        public string DisplayName { get; set; }
        public string State { get; set; }
        public bool Muted { get; set; }
        public int Volume { get; set; }
        public bool IsSystemSounds { get; set; }
    }

    public sealed class AudioSnapshotRecord
    {
        public AudioSnapshotRecord()
        {
            DefaultDeviceId = "";
            Source = "local bridge";
            Devices = new RenderDeviceRecord[0];
            Sessions = new AudioSessionRecord[0];
        }

        public string DefaultDeviceId { get; set; }
        public int MasterVolume { get; set; }
        public bool Muted { get; set; }
        public string Source { get; set; }
        public RenderDeviceRecord[] Devices { get; set; }
        public AudioSessionRecord[] Sessions { get; set; }
    }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumeratorComObject
    {
    }

    [ComImport]
    [Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    public class PolicyConfigClient
    {
    }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(EDataFlow dataFlow, DeviceState stateMask, [MarshalAs(UnmanagedType.Interface)] out IMMDeviceCollection devices);
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, [MarshalAs(UnmanagedType.Interface)] out IMMDevice endpoint);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string deviceId, [MarshalAs(UnmanagedType.Interface)] out IMMDevice device);
        int RegisterEndpointNotificationCallback(IntPtr client);
        int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport]
    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceCollection
    {
        int GetCount(out uint deviceCount);
        int Item(uint deviceNumber, [MarshalAs(UnmanagedType.Interface)] out IMMDevice device);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice
    {
        int Activate(ref Guid interfaceId, uint classContext, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
        int OpenPropertyStore(uint access, out IPropertyStore properties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string deviceId);
        int GetState(out DeviceState state);
    }

    [ComImport]
    [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore
    {
        int GetCount(out uint propertyCount);
        int GetAt(uint propertyIndex, out PropertyKey key);
        int GetValue(ref PropertyKey key, out PropVariant value);
        int SetValue(ref PropertyKey key, ref PropVariant value);
        int Commit();
    }

    [ComImport]
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolume
    {
        int RegisterControlChangeNotify(IntPtr notify);
        int UnregisterControlChangeNotify(IntPtr notify);
        int GetChannelCount(out uint channelCount);
        int SetMasterVolumeLevel(float levelDb, Guid eventContext);
        int SetMasterVolumeLevelScalar(float level, Guid eventContext);
        int GetMasterVolumeLevel(out float levelDb);
        int GetMasterVolumeLevelScalar(out float level);
        int SetChannelVolumeLevel(uint channelNumber, float levelDb, Guid eventContext);
        int SetChannelVolumeLevelScalar(uint channelNumber, float level, Guid eventContext);
        int GetChannelVolumeLevel(uint channelNumber, out float levelDb);
        int GetChannelVolumeLevelScalar(uint channelNumber, out float level);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid eventContext);
        int GetMute(out bool mute);
        int GetVolumeStepInfo(out uint step, out uint stepCount);
        int VolumeStepUp(Guid eventContext);
        int VolumeStepDown(Guid eventContext);
        int QueryHardwareSupport(out uint hardwareSupportMask);
        int GetVolumeRange(out float volumeMinDb, out float volumeMaxDb, out float volumeIncrementDb);
    }

    [ComImport]
    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionManager2
    {
        int GetAudioSessionControl(IntPtr sessionGuid, uint streamFlags, out IAudioSessionControl sessionControl);
        int GetSimpleAudioVolume(IntPtr sessionGuid, uint streamFlags, out ISimpleAudioVolume audioVolume);
        int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnumerator);
        int RegisterSessionNotification(IntPtr sessionNotification);
        int UnregisterSessionNotification(IntPtr sessionNotification);
        int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionIdentifier, IntPtr duckNotification);
        int UnregisterDuckNotification(IntPtr duckNotification);
    }

    [ComImport]
    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionEnumerator
    {
        int GetCount(out int sessionCount);
        int GetSession(int sessionIndex, out IAudioSessionControl session);
    }

    [ComImport]
    [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionControl
    {
        int GetState(out AudioSessionState state);
        int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string displayName, [MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
        int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string iconPath);
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string iconPath, [MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
        int GetGroupingParam(out Guid groupingId);
        int SetGroupingParam([MarshalAs(UnmanagedType.LPStruct)] Guid groupingId, [MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
        int RegisterAudioSessionNotification(IntPtr notifications);
        int UnregisterAudioSessionNotification(IntPtr notifications);
    }

    [ComImport]
    [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionControl2
    {
        int GetState(out AudioSessionState state);
        int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string displayName, [MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
        int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string iconPath);
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string iconPath, [MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
        int GetGroupingParam(out Guid groupingId);
        int SetGroupingParam([MarshalAs(UnmanagedType.LPStruct)] Guid groupingId, [MarshalAs(UnmanagedType.LPStruct)] Guid eventContext);
        int RegisterAudioSessionNotification(IntPtr notifications);
        int UnregisterAudioSessionNotification(IntPtr notifications);
        int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string sessionIdentifier);
        int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string sessionInstanceIdentifier);
        int GetProcessId(out uint processId);
        int IsSystemSoundsSession();
        int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }

    [ComImport]
    [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ISimpleAudioVolume
    {
        int SetMasterVolume(float level, ref Guid eventContext);
        int GetMasterVolume(out float level);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
        int GetMute(out bool mute);
    }

    [ComImport]
    [Guid("F8679F50-850A-41CF-9C72-430F290290C8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPolicyConfig
    {
        int GetMixFormat();
        int GetDeviceFormat();
        int ResetDeviceFormat();
        int SetDeviceFormat();
        int GetProcessingPeriod();
        int SetProcessingPeriod();
        int GetShareMode();
        int SetShareMode();
        int GetPropertyValue();
        int SetPropertyValue();
        int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, ERole role);
        int SetEndpointVisibility();
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PropertyKey
    {
        public Guid FormatId;
        public int PropertyId;

        public PropertyKey(Guid formatId, int propertyId)
        {
            FormatId = formatId;
            PropertyId = propertyId;
        }
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct PropVariant : IDisposable
    {
        [FieldOffset(0)]
        private ushort variantType;

        [FieldOffset(8)]
        private IntPtr pointerValue;

        public string Value
        {
            get
            {
                return variantType == 31 && pointerValue != IntPtr.Zero
                    ? Marshal.PtrToStringUni(pointerValue) ?? ""
                    : "";
            }
        }

        public void Dispose()
        {
            NativeMethods.PropVariantClear(ref this);
        }
    }

    public static class AudioBridge
    {
        private const uint ClsCtxAll = 23;
        private const uint StgmRead = 0;
        private static readonly PropertyKey DeviceFriendlyNameKey = new PropertyKey(new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), 14);

        public static AudioSnapshotRecord GetSnapshot()
        {
            var defaultDevice = GetDefaultRenderDevice();
            string defaultDeviceId;
            defaultDevice.GetId(out defaultDeviceId);

            return new AudioSnapshotRecord
            {
                DefaultDeviceId = defaultDeviceId ?? "",
                MasterVolume = GetEndpointVolumePercent(defaultDevice),
                Muted = GetEndpointMuteState(defaultDevice),
                Source = "windows core audio",
                Devices = GetRenderDevices(defaultDeviceId ?? ""),
                Sessions = GetRenderSessions(defaultDevice)
            };
        }

        public static RenderDeviceRecord[] GetRenderDevices()
        {
            return GetRenderDevices(GetDefaultRenderDeviceId());
        }

        public static void SetDefaultDevice(string deviceId)
        {
            if (string.IsNullOrWhiteSpace(deviceId))
            {
                throw new ArgumentException("Device ID is required.", "deviceId");
            }

            var policy = (IPolicyConfig)new PolicyConfigClient();
            Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(deviceId, ERole.eConsole));
            Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(deviceId, ERole.eMultimedia));
            Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(deviceId, ERole.eCommunications));
        }

        public static void SetMasterVolume(string deviceId, float scalar)
        {
            var endpoint = ActivateEndpointVolume(deviceId);
            var clamped = Math.Max(0f, Math.Min(1f, scalar));
            Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar(clamped, Guid.Empty));
        }

        public static void SetMasterMute(string deviceId, bool muted)
        {
            var endpoint = ActivateEndpointVolume(deviceId);
            Marshal.ThrowExceptionForHR(endpoint.SetMute(muted, Guid.Empty));
        }

        public static void SetSessionVolume(string deviceId, string sessionIdentifier, float scalar)
        {
            if (string.IsNullOrWhiteSpace(sessionIdentifier))
            {
                throw new ArgumentException("Session identifier is required.", "sessionIdentifier");
            }

            var sessionVolume = FindSessionVolume(deviceId, sessionIdentifier);
            var clamped = Math.Max(0f, Math.Min(1f, scalar));
            var eventContext = Guid.Empty;
            Marshal.ThrowExceptionForHR(sessionVolume.SetMasterVolume(clamped, ref eventContext));
        }

        public static void SetSessionMute(string deviceId, string sessionIdentifier, bool muted)
        {
            if (string.IsNullOrWhiteSpace(sessionIdentifier))
            {
                throw new ArgumentException("Session identifier is required.", "sessionIdentifier");
            }

            var sessionVolume = FindSessionVolume(deviceId, sessionIdentifier);
            var eventContext = Guid.Empty;
            Marshal.ThrowExceptionForHR(sessionVolume.SetMute(muted, ref eventContext));
        }

        private static RenderDeviceRecord[] GetRenderDevices(string defaultDeviceId)
        {
            var enumerator = CreateEnumerator();
            IMMDeviceCollection collection;
            uint count;
            Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(EDataFlow.eRender, DeviceState.MaskAll, out collection));
            Marshal.ThrowExceptionForHR(collection.GetCount(out count));

            var devices = new List<RenderDeviceRecord>((int)count);
            for (uint index = 0; index < count; index += 1)
            {
                IMMDevice device;
                string deviceId;
                DeviceState deviceState;
                Marshal.ThrowExceptionForHR(collection.Item(index, out device));
                Marshal.ThrowExceptionForHR(device.GetId(out deviceId));
                Marshal.ThrowExceptionForHR(device.GetState(out deviceState));
                devices.Add(new RenderDeviceRecord
                {
                    Id = deviceId ?? "",
                    Name = GetDeviceFriendlyName(device),
                    State = deviceState.ToString(),
                    IsDefault = string.Equals(deviceId, defaultDeviceId, StringComparison.OrdinalIgnoreCase)
                });
            }

            return devices.ToArray();
        }

        private static AudioSessionRecord[] GetRenderSessions(IMMDevice device)
        {
            var sessionManager = ActivateSessionManager(device);
            IAudioSessionEnumerator enumerator;
            int count;
            Marshal.ThrowExceptionForHR(sessionManager.GetSessionEnumerator(out enumerator));
            Marshal.ThrowExceptionForHR(enumerator.GetCount(out count));

            var sessions = new List<AudioSessionRecord>(Math.Max(count, 0));
            for (var index = 0; index < count; index += 1)
            {
                IAudioSessionControl control;
                string sessionIdentifier;
                uint processId;
                AudioSessionState sessionState;
                string displayName;
                float level;
                bool muted;
                Marshal.ThrowExceptionForHR(enumerator.GetSession(index, out control));

                var control2 = (IAudioSessionControl2)control;
                var volume = (ISimpleAudioVolume)control;

                Marshal.ThrowExceptionForHR(control2.GetSessionIdentifier(out sessionIdentifier));
                Marshal.ThrowExceptionForHR(control2.GetProcessId(out processId));
                Marshal.ThrowExceptionForHR(control2.GetState(out sessionState));
                control2.GetDisplayName(out displayName);
                volume.GetMasterVolume(out level);
                volume.GetMute(out muted);

                var isSystemSounds =
                    processId == 0 ||
                    (!string.IsNullOrEmpty(displayName) && displayName.StartsWith("@%SystemRoot", StringComparison.OrdinalIgnoreCase));

                sessions.Add(new AudioSessionRecord
                {
                    Identifier = sessionIdentifier ?? "",
                    ProcessId = processId,
                    DisplayName = displayName ?? "",
                    State = sessionState.ToString(),
                    Muted = muted,
                    Volume = (int)Math.Round(Math.Max(0f, Math.Min(1f, level)) * 100f),
                    IsSystemSounds = isSystemSounds
                });
            }

            return sessions.ToArray();
        }

        private static ISimpleAudioVolume FindSessionVolume(string deviceId, string sessionIdentifier)
        {
            var device = ResolveRenderDevice(deviceId);
            var sessionManager = ActivateSessionManager(device);
            IAudioSessionEnumerator enumerator;
            int count;
            Marshal.ThrowExceptionForHR(sessionManager.GetSessionEnumerator(out enumerator));
            Marshal.ThrowExceptionForHR(enumerator.GetCount(out count));

            for (var index = 0; index < count; index += 1)
            {
                IAudioSessionControl control;
                string currentIdentifier;
                Marshal.ThrowExceptionForHR(enumerator.GetSession(index, out control));
                var control2 = (IAudioSessionControl2)control;
                Marshal.ThrowExceptionForHR(control2.GetSessionIdentifier(out currentIdentifier));

                if (string.Equals(currentIdentifier, sessionIdentifier, StringComparison.Ordinal))
                {
                    return (ISimpleAudioVolume)control;
                }
            }

            throw new InvalidOperationException("Audio session not found.");
        }

        private static int GetEndpointVolumePercent(IMMDevice device)
        {
            var endpoint = ActivateEndpointVolume(device);
            float level;
            Marshal.ThrowExceptionForHR(endpoint.GetMasterVolumeLevelScalar(out level));
            return (int)Math.Round(Math.Max(0f, Math.Min(1f, level)) * 100f);
        }

        private static bool GetEndpointMuteState(IMMDevice device)
        {
            var endpoint = ActivateEndpointVolume(device);
            bool muted;
            Marshal.ThrowExceptionForHR(endpoint.GetMute(out muted));
            return muted;
        }

        private static string GetDefaultRenderDeviceId()
        {
            var device = GetDefaultRenderDevice();
            string deviceId;
            Marshal.ThrowExceptionForHR(device.GetId(out deviceId));
            return deviceId ?? "";
        }

        private static IMMDevice GetDefaultRenderDevice()
        {
            var enumerator = CreateEnumerator();
            IMMDevice device;
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device));
            return device;
        }

        private static IMMDevice ResolveRenderDevice(string deviceId)
        {
            if (string.IsNullOrWhiteSpace(deviceId))
            {
                return GetDefaultRenderDevice();
            }

            var enumerator = CreateEnumerator();
            IMMDevice device;
            Marshal.ThrowExceptionForHR(enumerator.GetDevice(deviceId, out device));
            return device;
        }

        private static string GetDeviceFriendlyName(IMMDevice device)
        {
            try
            {
                IPropertyStore propertyStore;
                PropVariant value;
                var key = DeviceFriendlyNameKey;
                Marshal.ThrowExceptionForHR(device.OpenPropertyStore(StgmRead, out propertyStore));
                Marshal.ThrowExceptionForHR(propertyStore.GetValue(ref key, out value));
                using (value)
                {
                    return value.Value;
                }
            }
            catch
            {
                return "";
            }
        }

        private static IMMDeviceEnumerator CreateEnumerator()
        {
            return (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        }

        private static IAudioEndpointVolume ActivateEndpointVolume(string deviceId)
        {
            return ActivateEndpointVolume(ResolveRenderDevice(deviceId));
        }

        private static IAudioEndpointVolume ActivateEndpointVolume(IMMDevice device)
        {
            var interfaceId = typeof(IAudioEndpointVolume).GUID;
            object endpoint;
            Marshal.ThrowExceptionForHR(device.Activate(ref interfaceId, ClsCtxAll, IntPtr.Zero, out endpoint));
            return (IAudioEndpointVolume)endpoint;
        }

        private static IAudioSessionManager2 ActivateSessionManager(IMMDevice device)
        {
            var interfaceId = typeof(IAudioSessionManager2).GUID;
            object manager;
            Marshal.ThrowExceptionForHR(device.Activate(ref interfaceId, ClsCtxAll, IntPtr.Zero, out manager));
            return (IAudioSessionManager2)manager;
        }
    }

    internal static class NativeMethods
    {
        [DllImport("ole32.dll")]
        internal static extern int PropVariantClear(ref PropVariant propvar);
    }
}
