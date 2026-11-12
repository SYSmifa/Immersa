using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Immersa.EditorTools
{
    /// <summary>
    /// Command-line build of the development APK (Unity closed):
    /// Unity.exe -batchmode -nographics -projectPath unity -executeMethod Immersa.EditorTools.BuildScript.BuildDev -logFile build.log
    /// Same options as the builds made from the open editor.
    /// </summary>
    public static class BuildScript
    {
        /// <summary>Creates the Meta settings asset of the overlay canvases (the build refuses to start without it) and allows enough panels.</summary>
        static void EnsureOverlaySettings()
        {
            var settings = OVROverlayCanvasSettings.Instance;
            if (settings == null) return;
            if (settings.MaxSimultaneousCanvases < 8) settings.MaxSimultaneousCanvases = 8;
            EditorUtility.SetDirty(settings);
            AssetDatabase.SaveAssets();
        }

        /// <summary>Only compiles the scripts (Unity quits after loading them): errors show in the log. Much faster than a build.</summary>
        public static void CompileCheck()
        {
            EnsureOverlaySettings();
            Debug.Log("COMPILE OK");
            EditorApplication.Exit(0);
        }

        public static void BuildDev()
        {
            EnsureOverlaySettings();
            System.IO.Directory.CreateDirectory("Builds");
            var opts = new BuildPlayerOptions
            {
                scenes = new[] { "Assets/Scenes/Main.unity" },
                locationPathName = "Builds/Immersa-dev.apk",
                target = BuildTarget.Android,
                options = BuildOptions.Development
            };
            var report = BuildPipeline.BuildPlayer(opts);
            var s = report.summary;
            Debug.Log("BUILD RESULT: " + s.result + " | errors " + s.totalErrors + " | warnings " + s.totalWarnings + " | time " + s.totalTime);
            EditorApplication.Exit(s.result == BuildResult.Succeeded ? 0 : 1);
        }
    }
}
