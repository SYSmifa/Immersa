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
        public static void BuildDev()
        {
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
