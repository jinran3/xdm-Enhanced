using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Windows;

namespace XDM.Wpf.UI
{
    public class SkinResourceDictionary : ResourceDictionary
    {
        private Uri _darkSource;
        private Uri _lightSource;
        private Uri _youtubeDarkSource;
        private Uri _youtubeLightSource;

        public Uri DarkSource
        {
            get { return _darkSource; }
            set
            {
                _darkSource = value;
                UpdateSource();
            }
        }
        public Uri LightSource
        {
            get { return _lightSource; }
            set
            {
                _lightSource = value;
                UpdateSource();
            }
        }
        public Uri YoutubeDarkSource
        {
            get { return _youtubeDarkSource; }
            set
            {
                _youtubeDarkSource = value;
                UpdateSource();
            }
        }
        public Uri YoutubeLightSource
        {
            get { return _youtubeLightSource; }
            set
            {
                _youtubeLightSource = value;
                UpdateSource();
            }
        }

        private void UpdateSource()
        {
            var dark = App.Skin == Skin.Dark;
            var youtube = App.UseYouTubeTheme;
            var val = youtube
                ? (dark ? YoutubeDarkSource : YoutubeLightSource)
                : (dark ? DarkSource : LightSource);
            if (val != null && base.Source != val)
                base.Source = val;
        }
    }
}
