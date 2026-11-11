using UnityEngine;

namespace Immersa.Cloud
{
    /// <summary>
    /// Supabase project URL and anon key (the same public values the web app bundles).
    /// The asset lives in Assets/Config/Local* so git ignores it; it never holds a password.
    /// </summary>
    public class SupabaseConfig : ScriptableObject
    {
        public string url;
        public string anonKey;
    }
}
