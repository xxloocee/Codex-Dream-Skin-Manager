using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;

namespace CodexDreamSkinManager
{
    internal static class PreviewImageLoader
    {
        public static BitmapSource Load(string path, int maximumWidth)
        {
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path) || maximumWidth < 1) return null;
            string fullPath = Path.GetFullPath(path);
            if (string.Equals(Path.GetExtension(fullPath), ".mp4", StringComparison.OrdinalIgnoreCase))
                return LoadShellThumbnail(fullPath, maximumWidth);

            BitmapImage bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.DecodePixelWidth = maximumWidth;
            bitmap.UriSource = new Uri(fullPath, UriKind.Absolute);
            bitmap.EndInit();
            bitmap.Freeze();
            return bitmap;
        }

        private static BitmapSource LoadShellThumbnail(string path, int maximumWidth)
        {
            IShellItemImageFactory factory = null;
            IntPtr bitmapHandle = IntPtr.Zero;
            try
            {
                Guid interfaceId = typeof(IShellItemImageFactory).GUID;
                int result = SHCreateItemFromParsingName(path, IntPtr.Zero, ref interfaceId, out factory);
                if (result < 0 || factory == null) return null;
                result = factory.GetImage(new NativeSize(maximumWidth, maximumWidth),
                    ShellImageFlags.ResizeToFit | ShellImageFlags.ThumbnailOnly,
                    out bitmapHandle);
                if (result < 0 || bitmapHandle == IntPtr.Zero) return null;
                BitmapSource thumbnail = Imaging.CreateBitmapSourceFromHBitmap(bitmapHandle, IntPtr.Zero,
                    Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
                thumbnail.Freeze();
                return thumbnail;
            }
            catch { return null; }
            finally
            {
                if (bitmapHandle != IntPtr.Zero) DeleteObject(bitmapHandle);
                if (factory != null && Marshal.IsComObject(factory)) Marshal.FinalReleaseComObject(factory);
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeSize
        {
            public int Width;
            public int Height;

            public NativeSize(int width, int height)
            {
                Width = width;
                Height = height;
            }
        }

        [Flags]
        private enum ShellImageFlags
        {
            ResizeToFit = 0,
            ThumbnailOnly = 8
        }

        [ComImport]
        [Guid("BCC18B79-BA16-442F-80C4-8A59C30C463B")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellItemImageFactory
        {
            [PreserveSig]
            int GetImage(NativeSize size, ShellImageFlags flags, out IntPtr bitmapHandle);
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        private static extern int SHCreateItemFromParsingName(string path, IntPtr bindingContext,
            ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory factory);

        [DllImport("gdi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DeleteObject(IntPtr value);
    }
}
