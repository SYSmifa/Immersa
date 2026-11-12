using System;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace Immersa.Core
{
    // Compares two JSON values the way the data cares: objects ignore fields whose value is null (the web does not write them),
    // numbers compare as numbers (1 and 1.0 are the same), everything else must be equal. `diff` says where the first difference is.
    // Used to check that a list read from the cloud and written back by the Core types is the same data.
    public static class JsonCompare
    {
        public static bool Same(JToken a, JToken b, string path, out string diff)
        {
            diff = null;
            bool nullA = a == null || a.Type == JTokenType.Null, nullB = b == null || b.Type == JTokenType.Null;
            if (nullA || nullB) { if (nullA && nullB) return true; diff = path + (nullA ? ": null vs " + Short(b) : ": " + Short(a) + " vs null"); return false; }

            if (a.Type == JTokenType.Object || b.Type == JTokenType.Object)
            {
                if (a.Type != b.Type) { diff = path + ": object vs " + (a.Type == JTokenType.Object ? b.Type : a.Type); return false; }
                var oa = (JObject)a; var ob = (JObject)b;
                foreach (var key in oa.Properties().Select(p => p.Name).Union(ob.Properties().Select(p => p.Name)))
                    if (!Same(oa[key], ob[key], path + "." + key, out diff)) return false;
                return true;
            }
            if (a.Type == JTokenType.Array || b.Type == JTokenType.Array)
            {
                if (a.Type != b.Type) { diff = path + ": array vs " + (a.Type == JTokenType.Array ? b.Type : a.Type); return false; }
                var xa = (JArray)a; var xb = (JArray)b;
                if (xa.Count != xb.Count) { diff = path + ": " + xa.Count + " vs " + xb.Count + " items"; return false; }
                for (int i = 0; i < xa.Count; i++) if (!Same(xa[i], xb[i], path + "[" + i + "]", out diff)) return false;
                return true;
            }
            bool numA = a.Type == JTokenType.Integer || a.Type == JTokenType.Float, numB = b.Type == JTokenType.Integer || b.Type == JTokenType.Float;
            if (numA && numB)
            {
                if (Math.Abs((double)a - (double)b) < 1e-9) return true;
                diff = path + ": " + Short(a) + " vs " + Short(b);
                return false;
            }
            if (JToken.DeepEquals(a, b)) return true;
            diff = path + ": " + Short(a) + " vs " + Short(b);
            return false;
        }

        static string Short(JToken t) { var s = t == null ? "null" : t.ToString(Newtonsoft.Json.Formatting.None); return s.Length > 40 ? s.Substring(0, 40) + "..." : s; }
    }
}
