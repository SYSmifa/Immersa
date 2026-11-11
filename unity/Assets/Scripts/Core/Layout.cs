using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Immersa.Core
{
    // Port of src/room/layout.ts: where the rooms of a place are in relation to each other. Each room's saved scan can carry
    // `Links`: where the other rooms are, in its own frame. With one room placed in the session (by the headset itself or by
    // touching two corners) the others of the project are placed through those links, without asking anything.
    //
    // A pose maps a point of one frame to another frame: x' = c x - s z + tx, y' = y + ty, z' = s x + c z + tz, c = cos(yaw),
    // s = sin(yaw): the convention of Alignment and RoomLink.

    public readonly struct Pose
    {
        public readonly double Yaw, Tx, Ty, Tz;
        public Pose(double yaw, double tx, double ty, double tz) { Yaw = yaw; Tx = tx; Ty = ty; Tz = tz; }
        public static readonly Pose Identity = new Pose(0, 0, 0, 0);
        public static Pose Of(RoomLink l) => new Pose(l.Yaw, l.Tx, l.Ty, l.Tz);
        public static Pose Of(RoomLinkCandidate l) => new Pose(l.Yaw, l.Tx, l.Ty, l.Tz);
        public static Pose Of(Alignment a) => new Pose(a.Yaw, a.Tx, a.Ty, a.Tz);
    }

    // How sure a link is. The order matters: a path of links is as sure as its weakest one.
    public enum LinkState { Tentative = 0, Confirmed = 1, Manual = 2 }

    // How sure a placement is; Unknown: no link at all, the room is put aside.
    public enum PlaceState { Tentative = 0, Confirmed = 1, Manual = 2, Unknown = 3 }

    public class LinkView
    {
        public Pose Pose;
        public string Src;
        public RoomLink Link;
    }

    public class Learned
    {
        public RoomLink[] Links;       // [a.links[b], b.links[a]] to write; null = nothing to write
        public string Note;            // for the event log
    }

    public class Placement
    {
        public Pose Pose;              // where the room's frame is, in the frame of the room we look from
        public PlaceState State;
    }

    public class LinkSummaryItem
    {
        public string Name;
        public LinkState State;
    }

    public class ModelMove
    {
        public RoomModel Model;
        public Room To;
        public Vec3 Pos;               // its pivot in the new room's frame
        public double Yaw;
    }

    public enum StayWhy { Tentative, Ambiguous }

    public class ModelStay
    {
        public RoomModel Model;
        public Room To;                // the room it lies in, when only one
        public StayWhy Why;
    }

    // A dictionary that remembers the order things were added (the web uses Map, and the first match wins in several loops).
    public class OrderedMap<T>
    {
        readonly List<string> keys = new List<string>();
        readonly Dictionary<string, T> items = new Dictionary<string, T>();
        public int Count => keys.Count;
        public IEnumerable<string> Keys => keys;
        public IEnumerable<KeyValuePair<string, T>> Pairs => keys.Select(k => new KeyValuePair<string, T>(k, items[k]));
        public bool Has(string key) => items.ContainsKey(key);
        public T Get(string key) => items[key];
        public bool TryGet(string key, out T value) => items.TryGetValue(key, out value);
        public void Set(string key, T value)
        {
            if (!items.ContainsKey(key)) keys.Add(key);
            items[key] = value;
        }
    }

    public static class Layout
    {
        public static double Wrap(double a) => Math.Atan2(Math.Sin(a), Math.Cos(a));

        public static Vec3 Apply(Pose f, Vec3 p)
        {
            double c = Math.Cos(f.Yaw), s = Math.Sin(f.Yaw);
            return new Vec3(c * p.X - s * p.Z + f.Tx, p.Y + f.Ty, s * p.X + c * p.Z + f.Tz);
        }

        // f after g: first g, then f.
        public static Pose Compose(Pose f, Pose g)
        {
            var t = Apply(f, new Vec3(g.Tx, g.Ty, g.Tz));
            return new Pose(Wrap(f.Yaw + g.Yaw), t.X, t.Y, t.Z);
        }

        public static Pose Invert(Pose f)
        {
            double c = Math.Cos(f.Yaw), s = Math.Sin(f.Yaw);
            return new Pose(Wrap(-f.Yaw), -(c * f.Tx + s * f.Tz), -f.Ty, s * f.Tx - c * f.Tz);
        }

        // Where room B is in room A's frame, given where each one was placed in the same session (B -> session -> A).
        public static Pose Relative(Pose a, Pose b) => Compose(Invert(a), b);

        // How far apart two poses are: metres of translation and radians of turn.
        public static (double m, double rad) PoseDistance(Pose a, Pose b) =>
            (Math.Sqrt((a.Tx - b.Tx) * (a.Tx - b.Tx) + (a.Ty - b.Ty) * (a.Ty - b.Ty) + (a.Tz - b.Tz) * (a.Tz - b.Tz)), Math.Abs(Wrap(a.Yaw - b.Yaw)));

        const double AgreeM = 0.05;      // two measures of one link agree when closer than this ...
        const double AgreeRad = 0.0175;  // ... and than 1 degree

        static bool Agree(Pose a, Pose b)
        {
            var d = PoseDistance(a, b);
            return d.m < AgreeM && d.rad < AgreeRad;
        }

        public static LinkState StateOf(RoomLink l) => l.Src == "manual" ? LinkState.Manual : (l.N ?? 1) >= 2 ? LinkState.Confirmed : LinkState.Tentative;

        // Only a link measured by hand, or seen again by a second session, is trusted to put a room somewhere.
        public static bool IsConfirmed(RoomLink l) => StateOf(l) != LinkState.Tentative;

        // The same link seen from the other room (its candidate too).
        public static RoomLink InvertLink(RoomLink l)
        {
            var inv = Invert(Pose.Of(l));
            var r = l.ShallowCopy();
            r.Yaw = inv.Yaw; r.Tx = inv.Tx; r.Ty = inv.Ty; r.Tz = inv.Tz;
            if (l.Cand != null)
            {
                var ci = Invert(Pose.Of(l.Cand));
                var c = l.Cand.ShallowCopy();
                c.Yaw = ci.Yaw; c.Tx = ci.Tx; c.Ty = ci.Ty; c.Tz = ci.Tz;
                r.Cand = c;
            }
            return r;
        }

        // What room `from` knows about `to`: the link with `to` placed in `from`'s frame, from its own links or from the other
        // room's (inverted). null when there is none.
        public static LinkView LinkBetween(Room from, Room to)
        {
            RoomLink own = null;
            if (from.Scan?.Links != null) from.Scan.Links.TryGetValue(to.Id, out own);
            if (own != null) return new LinkView { Pose = Pose.Of(own), Src = own.Src, Link = own };
            RoomLink back = null;
            if (to.Scan?.Links != null) to.Scan.Links.TryGetValue(from.Id, out back);
            if (back == null) return null;
            var link = InvertLink(back);
            return new LinkView { Pose = Pose.Of(link), Src = link.Src, Link = link };
        }

        // Two rooms can only be linked when they belong to the same place, and they cannot be 100 m or more apart (a link from a
        // placement of the headset that puts them farther is a mistake: the headset also reports rooms of other places).
        public static bool Linkable(Room a, Room b, Pose pose)
        {
            if (a.Id == b.Id || !Places.Same(a.Place, b.Place)) return false;
            var ca = Floor.Centre(a.Scan.Planes);
            var cb = Apply(pose, Floor.Centre(b.Scan.Planes));
            return Math.Sqrt((ca.X - cb.X) * (ca.X - cb.X) + (ca.Z - cb.Z) * (ca.Z - cb.Z)) < 100;
        }

        static RoomLink Fresh(Pose p, double at, string src, int n, string sess) =>
            new RoomLink { Yaw = p.Yaw, Tx = p.Tx, Ty = p.Ty, Tz = p.Tz, At = at, Src = src, N = n, Sess = sess };

        static RoomLink[] Pair(RoomLink l) => new[] { l, InvertLink(l) };

        static double NowMs() => (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        // What to do with a new measure of where room `b` is in `a`'s frame (both were placed in one session: pa, pb).
        // - first measure from the headset: kept, but only as a guess (n = 1);
        // - the same again in another session: confirmed (n = 2);
        // - a different one: against a confirmed link it is thrown away; against a guess it is kept aside as a candidate, and the
        //   candidate wins when a later session agrees with it;
        // - by hand, or with both rooms scanned in this very session (`together`, no restart between): trusted at once. A hand
        //   measure replaces anything; the headset's never replaces one made by hand.
        // null: nothing to say or write. `nowMs`: the clock (milliseconds since the epoch), for tests.
        public static Learned LearnedLinks(Room a, Room b, Pose pa, Pose pb, string src, string sess, bool together = false, double? nowMs = null)
        {
            var bInA = Relative(pa, pb);
            if (!Linkable(a, b, bInA)) return null;
            var old = LinkBetween(a, b)?.Link;
            double now = nowMs ?? NowMs();
            bool trusted = src == "manual" || together;
            var fresh = Fresh(bInA, now, src, trusted ? 2 : 1, sess);
            if (old == null)
                return new Learned { Links = Pair(fresh), Note = trusted ? (src == "manual" ? "a mano" : "scansionate insieme: confermata") : "misura provvisoria: serve una seconda sessione" };
            bool same = Agree(Pose.Of(old), bInA);
            if (trusted)
            {
                if (src != "manual" && old.Src == "manual") return null;   // the headset's measure never replaces a hand one
                if (same && IsConfirmed(old)) return null;                  // nothing changes
                return new Learned { Links = Pair(fresh), Note = src == "manual" ? "a mano: sostituisce la misura precedente" : "scansionate insieme: confermata" };
            }
            if (old.Src == "manual") return null;
            if (same)
            {
                if (old.Sess == sess || IsConfirmed(old)) return null;      // nothing new
                var up = old.ShallowCopy();
                up.N = (old.N ?? 1) + 1; up.Sess = sess; up.At = now; up.Cand = null;
                return new Learned { Links = Pair(up), Note = "confermata da una seconda sessione" };
            }
            if (IsConfirmed(old))
            {
                var d = PoseDistance(Pose.Of(old), bInA);
                return new Learned { Links = null, Note = "misura scartata: differisce di " + d.m.ToString("F2", CultureInfo.InvariantCulture) + " m dalla posizione confermata" };
            }
            // a guess against a different measure
            var cand = old.Cand;
            if (cand != null && Agree(Pose.Of(cand), bInA))
            {
                if (cand.Sess == sess) return null;
                fresh.N = cand.N + 1;
                return new Learned { Links = Pair(fresh), Note = "confermata: la prima misura era diversa e non si è ripetuta" };
            }
            if (cand != null && cand.Sess == sess) return null;
            var withCand = old.ShallowCopy();
            withCand.Cand = new RoomLinkCandidate { Yaw = bInA.Yaw, Tx = bInA.Tx, Ty = bInA.Ty, Tz = bInA.Tz, At = now, N = 1, Sess = sess };
            return new Learned { Links = Pair(withCand), Note = "seconda misura diversa dalla prima: ne serve un'altra" };
        }

        // Places the rooms that have no placement of their own, through CONFIRMED links from the rooms that have one (`placed`),
        // hopping from room to room. Returns only the new placements.
        public static OrderedMap<Alignment> PlaceByLinks(IReadOnlyList<Room> rooms, OrderedMap<Alignment> placed)
        {
            var res = new OrderedMap<Alignment>();
            var known = new OrderedMap<Pose>();
            foreach (var kv in placed.Pairs) known.Set(kv.Key, Pose.Of(kv.Value));
            var byId = new Dictionary<string, Room>();
            foreach (var r in rooms) byId[r.Id] = r;
            for (int pass = 0; pass < rooms.Count; pass++)
            {
                bool grew = false;
                foreach (var target in rooms)
                {
                    if (known.Has(target.Id)) continue;
                    foreach (var kv in known.Pairs.ToList())
                    {
                        byId.TryGetValue(kv.Key, out var baseRoom);
                        var link = baseRoom != null ? LinkBetween(baseRoom, target) : null; // where `target` is in the base room's frame
                        if (baseRoom == null || link == null || !Places.Same(baseRoom.Place, target.Place) || !IsConfirmed(link.Link)) continue;
                        var alignment = Compose(kv.Value, link.Pose);   // target -> base -> session
                        known.Set(target.Id, alignment);
                        res.Set(target.Id, new Alignment { Yaw = alignment.Yaw, Tx = alignment.Tx, Ty = alignment.Ty, Tz = alignment.Tz, Resid = 0, Matched = 0, Total = 0 });
                        grew = true;
                        break;
                    }
                }
                if (!grew) break;
            }
            return res;
        }

        // For the lists: how a room stands with the other rooms of its place ("Cucina ✓", "Sala (da confermare)").
        public static List<LinkSummaryItem> LinkSummary(Room room, IEnumerable<Room> rooms)
        {
            var res = new List<LinkSummaryItem>();
            foreach (var other in rooms)
            {
                if (other.Id == room.Id || !Places.Same(other.Place, room.Place)) continue;
                var l = LinkBetween(room, other)?.Link;
                if (l != null) res.Add(new LinkSummaryItem { Name = other.Name, State = StateOf(l) });
            }
            return res;
        }

        // Where every other room of the project is, seen from `current` (the room being edited): through the links, hopping from
        // room to room, whatever their state (the editor shows a guess too, marked as such, so that a wrong one is seen). A room
        // with no link at all is put aside, on the floor level of `current` and to the east of it, one after the other, Unknown.
        public static OrderedMap<Placement> PlaceAround(Room current, IReadOnlyList<Room> members)
        {
            var res = new OrderedMap<Placement>();
            var byId = new Dictionary<string, Room>();
            foreach (var r in members) byId[r.Id] = r;
            byId[current.Id] = current;
            var known = new OrderedMap<(Pose pose, int rank)>();
            known.Set(current.Id, (Pose.Identity, (int)LinkState.Manual));
            for (int pass = 0; pass < members.Count; pass++)
            {
                bool grew = false;
                foreach (var target in members)
                {
                    if (known.Has(target.Id)) continue;
                    (Pose pose, int rank)? best = null;
                    foreach (var kv in known.Pairs)
                    {
                        byId.TryGetValue(kv.Key, out var baseRoom);
                        var link = baseRoom != null ? LinkBetween(baseRoom, target) : null;
                        if (baseRoom == null || link == null || !Places.Same(baseRoom.Place, target.Place)) continue;
                        int rank = Math.Min(kv.Value.rank, (int)StateOf(link.Link));
                        if (best == null || rank > best.Value.rank) best = (Compose(kv.Value.pose, link.Pose), rank);
                    }
                    if (best != null) { known.Set(target.Id, best.Value); grew = true; }
                }
                if (!grew) break;
            }
            foreach (var kv in known.Pairs)
                if (kv.Key != current.Id) res.Set(kv.Key, new Placement { Pose = kv.Value.pose, State = (PlaceState)kv.Value.rank });
            // the rest: aside
            var cur = Floor.Centre(current.Scan.Planes);
            double maxX = cur.X;
            foreach (var p in current.Scan.Planes) maxX = Math.Max(maxX, (p.Poly != null && p.Poly.Count >= 6) ? p.Pos.X + 3 : p.Pos.X);
            double east = maxX + 4;
            foreach (var r in members)
            {
                if (r.Id == current.Id || known.Has(r.Id)) continue;
                var c = Floor.Centre(r.Scan.Planes);
                var xs = r.Scan.Planes.Select(p => p.Pos.X).ToList();
                double width = xs.Count > 0 ? xs.Max() - xs.Min() + 2 : 4;
                res.Set(r.Id, new Placement { Pose = new Pose(0, east + width / 2 - c.X, cur.Y - c.Y, cur.Z - c.Z), State = PlaceState.Unknown });
                east += width + 3;
            }
            return res;
        }

        // Is this point (in the room's own frame) inside the room? Its floor outline, a little widened (0.15 m: a wall's
        // thickness), and between the floor and the ceiling; rooms scanned without an outline are judged by the box around their planes.
        public static bool RoomContains(Room room, Vec3 p, double margin = 0.15)
        {
            var planes = room.Scan.Planes;
            var floors = planes.Where(q => q.Label == "floor" && q.Quat != null && q.Poly != null && q.Poly.Count >= 6).ToList();
            var allFloors = planes.Where(q => q.Label == "floor").ToList();
            double floorY = allFloors.Count == 0 ? 0 : allFloors.Aggregate(0.0, (a, q) => a + q.Pos.Y / allFloors.Count);
            var ceil = planes.FirstOrDefault(q => q.Label == "ceiling");
            double top = ceil != null ? ceil.Pos.Y : floorY + 3.5;
            if (p.Y < floorY - 0.6 || p.Y > top + 0.3) return false;
            if (floors.Count == 0)
            {
                if (planes.Count == 0) return false;
                return p.X >= planes.Min(q => q.Pos.X) - 0.5 && p.X <= planes.Max(q => q.Pos.X) + 0.5
                    && p.Z >= planes.Min(q => q.Pos.Z) - 0.5 && p.Z <= planes.Max(q => q.Pos.Z) + 0.5;
            }
            foreach (var f in floors)
            {
                var q = f.Quat.Value;
                var pts = new List<(double x, double z)>();
                for (int i = 0; i + 1 < f.Poly.Count; i += 2)
                {
                    var v = Rot.Apply(q, new Vec3(f.Poly[i], 0, f.Poly[i + 1]));
                    pts.Add((v.X + f.Pos.X, v.Z + f.Pos.Z));
                }
                bool inside = false;
                double near = double.PositiveInfinity;
                for (int i = 0, j = pts.Count - 1; i < pts.Count; j = i++)
                {
                    var (xi, zi) = pts[i];
                    var (xj, zj) = pts[j];
                    if ((zi > p.Z) != (zj > p.Z) && p.X < ((xj - xi) * (p.Z - zi)) / (zj - zi) + xi) inside = !inside;
                    double dx = xj - xi, dz = zj - zi;
                    double den = dx * dx + dz * dz;
                    double t = Math.Max(0, Math.Min(1, ((p.X - xi) * dx + (p.Z - zi) * dz) / (den == 0 ? 1 : den)));
                    double ex = p.X - (xi + t * dx), ez = p.Z - (zi + t * dz);
                    near = Math.Min(near, Math.Sqrt(ex * ex + ez * ez));
                }
                if (inside || near <= margin) return true;
            }
            return false;
        }

        // Models of `current` (the room being edited) whose pivot is no longer inside it: where did they end up? Only a room whose
        // link with `current` is sure (confirmed or by hand) takes a model over; a guess, or a pivot lying in two rooms at once
        // (they overlap: a link is wrong), leaves it where it is and says so. A pivot in no room (a corridor, outdoors) leaves it
        // silently. The new position and yaw are the same place seen from the new room's frame.
        public static (List<ModelMove> moves, List<ModelStay> stay) PlanModelMoves(Room current, IReadOnlyList<Room> members, IEnumerable<RoomModel> models)
        {
            var around = PlaceAround(current, members);
            var moves = new List<ModelMove>();
            var stay = new List<ModelStay>();
            foreach (var m in models)
            {
                if (m.RoomId != current.Id || RoomContains(current, m.Pos)) continue;
                var hits = new List<(Room room, Placement place, Vec3 pos)>();
                foreach (var r in members)
                {
                    if (!around.TryGet(r.Id, out var place) || place.State == PlaceState.Unknown) continue; // put aside: its coordinates mean nothing
                    var pos = Apply(Invert(place.Pose), m.Pos);
                    if (RoomContains(r, pos)) hits.Add((r, place, pos));
                }
                if (hits.Count == 0) continue;
                if (hits.Count > 1) { stay.Add(new ModelStay { Model = m, To = null, Why = StayWhy.Ambiguous }); continue; }
                var h = hits[0];
                if (h.place.State == PlaceState.Tentative) { stay.Add(new ModelStay { Model = m, To = h.room, Why = StayWhy.Tentative }); continue; }
                moves.Add(new ModelMove { Model = m, To = h.room, Pos = h.pos, Yaw = m.Yaw + h.place.Pose.Yaw });
            }
            return (moves, stay);
        }
    }
}
