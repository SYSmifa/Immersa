using System;

namespace Immersa.Core
{
    // A point or direction in plan: x and z of the room's frame (y is up). Not the same type as Vec2 on purpose:
    // Vec2 is a JSON pair, P2 is geometry (named fields, no confusion between "y" and "z").
    public readonly struct P2
    {
        public readonly double X, Z;
        public P2(double x, double z) { X = x; Z = z; }
        public static P2 operator -(P2 a) => new P2(-a.X, -a.Z);
        public double Length => Math.Sqrt(X * X + Z * Z);
    }

    // Rotations the way three.js does them, so the numbers match the web app. Axes are the web's.
    public static class Rot
    {
        // Rotate a vector by a unit quaternion (three: Vector3.applyQuaternion).
        public static Vec3 Apply(Quat q, Vec3 v)
        {
            double tx = 2 * (q.Y * v.Z - q.Z * v.Y);
            double ty = 2 * (q.Z * v.X - q.X * v.Z);
            double tz = 2 * (q.X * v.Y - q.Y * v.X);
            return new Vec3(
                v.X + q.W * tx + (q.Y * tz - q.Z * ty),
                v.Y + q.W * ty + (q.Z * tx - q.X * tz),
                v.Z + q.W * tz + (q.X * ty - q.Y * tx));
        }

        // Quaternion of the Euler angles (x, y, z) in three's 'YXZ' order: Ry * Rx * Rz.
        public static Quat FromEulerYXZ(double x, double y, double z)
        {
            double c1 = Math.Cos(x / 2), c2 = Math.Cos(y / 2), c3 = Math.Cos(z / 2);
            double s1 = Math.Sin(x / 2), s2 = Math.Sin(y / 2), s3 = Math.Sin(z / 2);
            return new Quat(
                s1 * c2 * c3 + c1 * s2 * s3,
                c1 * s2 * c3 - s1 * c2 * s3,
                c1 * c2 * s3 - s1 * s2 * c3,
                c1 * c2 * c3 + s1 * s2 * s3);
        }

        // Unit normal of a plane: its local Y axis rotated by the plane's orientation (align.ts planeNormal).
        public static Vec3 PlaneNormal(Quat q) =>
            new Vec3(2 * q.X * q.Y - 2 * q.W * q.Z, 1 - 2 * (q.Z * q.Z + q.X * q.X), 2 * q.W * q.X + 2 * q.Y * q.Z);

        // JavaScript's Math.round (halves go up), for texts that must read like the web app's.
        public static double JsRound(double v) => Math.Floor(v + 0.5);
    }
}
