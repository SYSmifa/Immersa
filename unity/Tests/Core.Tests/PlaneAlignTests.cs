using System;
using System.Collections.Generic;
using System.Linq;
using Immersa.Core;

namespace Immersa.Core.Tests
{
    // PlaneAlign (port of alignPlanes in src/room/align.ts): a saved room is turned and moved by a known amount; the alignment
    // must find that amount again, also with planes missing from the live scan.
    internal static class PlaneAlignTests
    {
        public static void All(Action<string, Action> run)
        {
            run("PlaneAlign: finds a known yaw and translation", FindsKnownPlacement);
            run("PlaneAlign: still finds it when a wall is missing and furniture moved", MissingPlanes);
            run("PlaneAlign: a box-shaped room is not found turned by 180 degrees", NotHalfTurned);
            run("PlaneAlign: nothing in common gives a weak or no match", NothingInCommon);
        }

        // Quaternion helpers (x, y, z, w).
        static Quat Mul(Quat a, Quat b) => new Quat(
            a.W * b.X + a.X * b.W + a.Y * b.Z - a.Z * b.Y,
            a.W * b.Y - a.X * b.Z + a.Y * b.W + a.Z * b.X,
            a.W * b.Z + a.X * b.Y - a.Y * b.X + a.Z * b.W,
            a.W * b.W - a.X * b.X - a.Y * b.Y - a.Z * b.Z);
        static Quat AxisAngle(double x, double y, double z, double angle) { double s = Math.Sin(angle / 2); return new Quat(x * s, y * s, z * s, Math.Cos(angle / 2)); }

        static RoomPlane Plane(string label, double x, double y, double z, Quat q) => new RoomPlane { Label = label, Pos = new Vec3(x, y, z), Quat = q };

        // A 4 x 3 m room, 2.5 m high, a door and a window: normals follow the plane's local Y axis.
        static List<RoomPlane> Room()
        {
            var up = new Quat(0, 0, 0, 1);                              // normal +Y
            var wallX = AxisAngle(0, 0, 1, -Math.PI / 2);                // normal +X
            var wallZ = AxisAngle(1, 0, 0, Math.PI / 2);                  // normal +Z
            return new List<RoomPlane>
            {
                Plane("floor", 0, 0, 0, up), Plane("ceiling", 0, 2.5, 0, up),
                Plane("wall", 2.0, 1.25, 0, wallX), Plane("wall", -2.0, 1.25, 0, wallX),
                Plane("wall", 0, 1.25, 1.5, wallZ), Plane("wall", 0, 1.25, -1.5, wallZ),
                Plane("door", 2.0, 1.0, 0.7, wallX), Plane("window", -0.6, 1.4, -1.5, wallZ),
            };
        }

        // The same planes as seen in another session: x' = c x - s z + tx ... (the Alignment convention).
        static List<RoomPlane> Moved(List<RoomPlane> planes, double yaw, double tx, double ty, double tz)
        {
            double c = Math.Cos(yaw), s = Math.Sin(yaw);
            var turn = AxisAngle(0, 1, 0, -yaw);   // the matrix [[c,0,-s],[0,1,0],[s,0,c]] is a standard rotation by -yaw about Y
            return planes.Select(p => new RoomPlane
            {
                Label = p.Label,
                Pos = new Vec3(c * p.Pos.X - s * p.Pos.Z + tx, p.Pos.Y + ty, s * p.Pos.X + c * p.Pos.Z + tz),
                Quat = Mul(turn, p.Quat.Value),
            }).ToList();
        }

        static void Near(string what, double got, double want, double tol)
        {
            if (Math.Abs(got - want) > tol) throw new Exception(what + ": got " + got.ToString("0.0000") + ", want " + want.ToString("0.0000"));
        }

        static double WrapAngle(double a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

        static void FindsKnownPlacement()
        {
            var saved = Room();
            double yaw = 37 * Math.PI / 180;
            var live = Moved(saved, yaw, 1.2, 0.05, -2.3);
            var a = PlaneAlign.AlignPlanes(saved, live);
            if (a == null) throw new Exception("no alignment");
            Near("yaw", WrapAngle(a.Yaw - yaw), 0, 0.01);
            Near("tx", a.Tx, 1.2, 0.02);
            Near("ty", a.Ty, 0.05, 0.02);
            Near("tz", a.Tz, -2.3, 0.02);
            if (a.Matched < saved.Count - 1) throw new Exception("matched " + a.Matched + "/" + a.Total);
        }

        static void MissingPlanes()
        {
            var saved = Room();
            double yaw = -120 * Math.PI / 180;
            var live = Moved(saved, yaw, -3.4, 0.0, 0.9);
            live.RemoveAt(5);                                   // one wall not scanned this time
            live.Add(Plane("table", 0.4, 0.7, 0.2, new Quat(0, 0, 0, 1)));   // furniture that was not in the saved room
            var a = PlaneAlign.AlignPlanes(saved, live);
            if (a == null) throw new Exception("no alignment");
            Near("yaw", WrapAngle(a.Yaw - yaw), 0, 0.02);
            Near("tx", a.Tx, -3.4, 0.05);
            Near("tz", a.Tz, 0.9, 0.05);
        }

        static void NotHalfTurned()
        {
            // The door and the window are what tell a room from its half-turned twin: with them in the live scan the answer is the true one.
            var saved = Room();
            double yaw = 180 * Math.PI / 180;
            var live = Moved(saved, yaw, 0.5, 0, 0.5);
            var a = PlaneAlign.AlignPlanes(saved, live);
            if (a == null) throw new Exception("no alignment");
            Near("yaw", Math.Abs(WrapAngle(a.Yaw - yaw)), 0, 0.02);
            Near("tx", a.Tx, 0.5, 0.05);
            Near("tz", a.Tz, 0.5, 0.05);
        }

        static void NothingInCommon()
        {
            var saved = Room();
            var live = new List<RoomPlane> { Plane("table", 5, 0.7, 5, new Quat(0, 0, 0, 1)) };
            var a = PlaneAlign.AlignPlanes(saved, live);
            if (a != null && a.Matched >= 3) throw new Exception("a match was invented: " + a.Matched);
        }
    }
}
