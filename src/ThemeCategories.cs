using System;
using System.Collections.Generic;
using System.IO;

namespace CodexDreamSkinManager
{
    // Categories are derived from tags so older theme files and packages stay compatible.
    internal static class ThemeCategories
    {
        public static readonly string[] Ids = { "dynamic", "people", "anime", "landscape", "city", "animals", "technology", "art" };
        public static readonly string[] Labels = { "动态", "人物", "动漫", "风景", "城市", "萌宠", "科技", "艺术" };

        public static List<string> GetIds(ThemeOption theme)
        {
            List<string> result = new List<string>();
            for (int i = 0; i < Ids.Length; i++)
            {
                if (string.Equals(theme.Category, Ids[i], StringComparison.OrdinalIgnoreCase) ||
                    (theme.Tags ?? new List<string>()).Exists(tag =>
                        string.Equals(tag, Labels[i], StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(tag, Ids[i], StringComparison.OrdinalIgnoreCase)))
                    result.Add(Ids[i]);
            }
            string extension = Path.GetExtension(theme.ImagePath ?? "");
            if ((string.Equals(extension, ".mp4", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(extension, ".gif", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(extension, ".apng", StringComparison.OrdinalIgnoreCase)) && !result.Contains("dynamic"))
                result.Insert(0, "dynamic");
            if (result.Count == 0 || (result.Count == 1 && result[0] == "dynamic"))
            {
                switch ((theme.Category ?? "").ToLowerInvariant())
                {
                    case "nature": result.Add("landscape"); break;
                    case "cyber": result.Add("technology"); break;
                    default: if (result.Count == 0) result.Add("art"); break;
                }
            }
            return result;
        }

        public static string GetLabel(ThemeOption theme)
        {
            List<string> labels = new List<string>();
            foreach (string id in GetIds(theme)) labels.Add(Labels[Array.IndexOf(Ids, id)]);
            return string.Join(" · ", labels.ToArray());
        }
    }
}
