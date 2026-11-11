using Immersa.Core;
using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>
    /// The ONE place that converts the web app's space (three.js: right-handed, y up) to Unity's (left-handed, y up).
    /// Convention: Unity = web with z negated. Everything saved by the web app (positions, yaw, tilt) goes through here.
    ///
    /// glTFast imports a GLB by negating X (glTF is right-handed, +Z forward like Unity). Our world mapping negates Z
    /// instead, and the two differ by a half turn about Y: imported models get <see cref="ImportFix"/> so that they face
    /// the way they do in the web app.
    /// </summary>
    public static class WebSpace
    {
        /// <summary>Half turn about Y to apply to the content of a GLB imported with glTFast.</summary>
        public static readonly Quaternion ImportFix = Quaternion.Euler(0f, 180f, 0f);

        public static Vector3 Position(Vec3 p) => new Vector3((float)p.X, (float)p.Y, -(float)p.Z);

        /// <summary>
        /// Web orientation = Ry(yaw) * Rx(tilt.x) * Rz(tilt.y), radians. Mirroring z turns rotations about X and Y into their
        /// opposites and leaves the one about Z; Unity's Euler applies Z, then X, then Y, i.e. Ry * Rx * Rz as well.
        /// </summary>
        public static Quaternion Orientation(double yaw, Vec2? tilt)
        {
            float tx = tilt.HasValue ? (float)tilt.Value.X : 0f;
            float tz = tilt.HasValue ? (float)tilt.Value.Y : 0f;
            return Quaternion.Euler(-tx * Mathf.Rad2Deg, -(float)yaw * Mathf.Rad2Deg, tz * Mathf.Rad2Deg);
        }
    }
}
