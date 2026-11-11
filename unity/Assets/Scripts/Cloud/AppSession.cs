namespace Immersa.Cloud
{
    /// <summary>The signed-in Supabase client, shared by the parts of the app (set once the user has signed in).</summary>
    public static class AppSession
    {
        public static SupabaseClient Client;
    }
}
