using System;
using Immersa.Core;
using Immersa.Ui;
using UnityEngine;
using UnityEngine.UI;

namespace Immersa.Quest
{
    /// <summary>
    /// Scale and turn the grabbed model with the other hand, like the web headset app: while the dominant hand holds a model (pinch)
    /// the secondary hand pinches too, and the DISTANCE between the hands scales the model while the ANGLE between them turns it in
    /// place. One gesture at a time (the first to pass its threshold stays until the pinch is released; pinch again to change).
    /// Magnetic steps: the turn snaps to 15 degrees from where it started, the scale to round values. Two cards between you and the
    /// model show Rotazione and Scala with the value and where it started; the one in use lights up.
    /// </summary>
    public class TwoHandGesture : MonoBehaviour
    {
        const float ScaleStart = 0.10f;   // ratio change before the scale gesture starts
        const float TurnStart = 12f;      // degrees before the turn gesture starts
        const float TurnStep = 15f;

        enum Mode { None, Scale, Turn }

        AppController app;
        OVRHand[] hands;
        float handsRefresh;

        // the gesture being made
        bool active;
        Mode mode;
        GameObject holder;
        RoomModel model;
        float dist0, angle0;
        double scale0, yaw0;
        Vector3 pos0;
        bool changed;
        bool wasDominantPinch;
        int pinchFrame = -100;

        // the cards
        RectTransform rotCard, scaleCard;
        Text rotText, scaleText;
        Image rotBox, scaleBox;
        ObjectButton button;

        public void Init(AppController owner, ObjectButton objectButton)
        {
            app = owner;
            button = objectButton;
            rotCard = MakeCard("RotationCard", "Rotazione", out rotText, out rotBox);
            scaleCard = MakeCard("ScaleCard", "Scala", out scaleText, out scaleBox);
            rotCard.gameObject.SetActive(false);
            scaleCard.gameObject.SetActive(false);
        }

        RectTransform MakeCard(string name, string title, out Text value, out Image box)
        {
            var c = UiKit.NewCanvas(name, transform, 360, 150);
            box = UiKit.Box(c, 0, 0, 360, 150, UiTheme.Bg1, true, "Card");
            UiKit.Label(c, 24, 14, 312, 34, title.ToUpperInvariant(), 22, UiTheme.HeaderSub, TextAnchor.UpperLeft, true);
            value = UiKit.Label(c, 24, 46, 312, 60, "", 44, Color.white, TextAnchor.UpperLeft, true);
            return c;
        }

        static Camera Cam() => Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();

        void Update()
        {
            var session = app != null ? app.Session : null;
            var grabbed = session != null ? session.Grabbed : null;
            if (hands == null || Time.unscaledTime > handsRefresh) { hands = FindObjectsByType<OVRHand>(FindObjectsInactive.Exclude, FindObjectsSortMode.None); handsRefresh = Time.unscaledTime + 1.5f; }

            OVRHand dominant = null, secondary = null;
            bool dominantPinch = false, secondaryPinch = false;
            bool secondaryIsLeft = app.DominantRight;
            foreach (var h in hands)
            {
                if (h == null || !h.IsTracked) continue;
                bool pinching = h.GetFingerIsPinching(OVRHand.HandFinger.Index);
                if (SecondaryHand.IsLeft(h.transform) == secondaryIsLeft) { secondary = h; secondaryPinch = pinching; }
                else { dominant = h; dominantPinch = pinching; }
            }

            // A pinch that selects nothing (no model, no button) deselects, like the web app (not while the menu is open).
            if (dominantPinch && !wasDominantPinch) pinchFrame = Time.frameCount;
            wasDominantPinch = dominantPinch;
            if (pinchFrame > 0 && Time.frameCount >= pinchFrame + 3)
            {
                if (session != null && session.Selected != null && session.Grabbed == null && UiKit.LastSelectFrame < pinchFrame && !app.MenuOpen) session.Select(null);
                pinchFrame = -100;
            }

            bool want = grabbed != null && dominant != null && secondary != null && dominantPinch && secondaryPinch;
            if (want && !active) Begin(session, grabbed, dominant, secondary);
            else if (!want && active) End(session);
            if (!active) return;

            // distance and angle of the line between the pinch points of the two hands, in the horizontal plane for the angle
            var a = dominant.PointerPose != null ? dominant.PointerPose.position : dominant.transform.position;
            var b = secondary.PointerPose != null ? secondary.PointerPose.position : secondary.transform.position;
            float d = Vector3.Distance(a, b);
            float ang = Mathf.Atan2(b.x - a.x, b.z - a.z) * Mathf.Rad2Deg;
            float ratio = dist0 > 0.01f ? d / dist0 : 1f;
            float turn = Mathf.DeltaAngle(angle0, ang);

            if (mode == Mode.None)
            {
                if (Mathf.Abs(ratio - 1f) > ScaleStart) mode = Mode.Scale;
                else if (Mathf.Abs(turn) > TurnStart) mode = Mode.Turn;
            }
            if (mode == Mode.Scale)
            {
                model.Scale = Math.Max(0.001, SnapScale(scale0 * ratio));
                changed = true;
            }
            else if (mode == Mode.Turn)
            {
                float snapped = Mathf.Round(turn / TurnStep) * TurnStep;
                model.Yaw = yaw0 - snapped * Mathf.Deg2Rad;    // a turn of the hands by +d degrees (Unity, clockwise from above) is -d in the web's yaw
                changed = true;
            }
            if (mode != Mode.None) ModelPose.ApplyTransform(model, holder.transform);
            holder.transform.position = pos0;                      // it turns / grows in place: the dominant hand does not carry it meanwhile
            UpdateCards();
        }

        void Begin(ProjectEditSession session, GameObject grabbed, OVRHand dominant, OVRHand secondary)
        {
            holder = grabbed;
            model = session.ModelOf(grabbed);
            if (model == null) return;
            var a = dominant.PointerPose != null ? dominant.PointerPose.position : dominant.transform.position;
            var b = secondary.PointerPose != null ? secondary.PointerPose.position : secondary.transform.position;
            dist0 = Vector3.Distance(a, b);
            angle0 = Mathf.Atan2(b.x - a.x, b.z - a.z) * Mathf.Rad2Deg;
            scale0 = model.Scale; yaw0 = model.Yaw;
            pos0 = holder.transform.position;
            mode = Mode.None; changed = false; active = true;
            PlaceCards();
            rotCard.gameObject.SetActive(true);
            scaleCard.gameObject.SetActive(true);
            UpdateCards();
        }

        void End(ProjectEditSession session)
        {
            active = false;
            rotCard.gameObject.SetActive(false);
            scaleCard.gameObject.SetActive(false);
            if (changed && model != null) session.Edited(model);
            model = null; holder = null;
        }

        static double SnapScale(double s)
        {
            double step = s < 1 ? 0.05 : s < 3 ? 0.1 : s < 10 ? 0.5 : 1;
            return Math.Round(s / step) * step;
        }

        void PlaceCards()
        {
            var cam = Cam();
            if (cam == null || holder == null) return;
            var anchor = button != null ? button.SpotFor(holder) : holder.transform.position + Vector3.up;
            var toHead = cam.transform.position - anchor; toHead.y = 0;
            var look = Quaternion.LookRotation(toHead.sqrMagnitude > 1e-4f ? -toHead.normalized : Vector3.forward, Vector3.up);
            var right = look * Vector3.right;
            rotCard.position = anchor - right * 0.22f; rotCard.rotation = look;
            scaleCard.position = anchor + right * 0.22f; scaleCard.rotation = look;
        }

        void UpdateCards()
        {
            if (model == null) return;
            double deg = model.Yaw * Mathf.Rad2Deg;
            rotText.text = deg.ToString("0.#") + "°";
            scaleText.text = model.Scale.ToString("0.##");
            rotBox.color = mode == Mode.Turn ? UiTheme.Accent : UiTheme.Bg1;
            scaleBox.color = mode == Mode.Scale ? UiTheme.Accent : UiTheme.Bg1;
        }
    }
}
