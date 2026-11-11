using System;

namespace Immersa.Core
{
    // A 4x4 matrix as three.js has it (column-major: element [col * 4 + row]), with the operations of Matrix4 that the model
    // parts need. Same formulas as three, so the numbers match the web app's.
    public sealed class Mat4
    {
        public readonly double[] E = new double[16];

        public static Mat4 Identity()
        {
            var m = new Mat4();
            m.E[0] = m.E[5] = m.E[10] = m.E[15] = 1;
            return m;
        }

        public Mat4 Clone() { var m = new Mat4(); Array.Copy(E, m.E, 16); return m; }

        public static Mat4 Translation(double x, double y, double z) { var m = Identity(); m.E[12] = x; m.E[13] = y; m.E[14] = z; return m; }
        public static Mat4 Scaling(double x, double y, double z) { var m = Identity(); m.E[0] = x; m.E[5] = y; m.E[10] = z; return m; }

        public static Mat4 RotationY(double theta)
        {
            double c = Math.Cos(theta), s = Math.Sin(theta);
            var m = Identity();
            m.E[0] = c; m.E[2] = -s; m.E[8] = s; m.E[10] = c;
            return m;
        }

        public static Mat4 Compose(Vec3 p, Quat q, Vec3 s)
        {
            var m = new Mat4();
            double x = q.X, y = q.Y, z = q.Z, w = q.W;
            double x2 = x + x, y2 = y + y, z2 = z + z;
            double xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
            double wx = w * x2, wy = w * y2, wz = w * z2;
            var e = m.E;
            e[0] = (1 - (yy + zz)) * s.X; e[1] = (xy + wz) * s.X; e[2] = (xz - wy) * s.X; e[3] = 0;
            e[4] = (xy - wz) * s.Y; e[5] = (1 - (xx + zz)) * s.Y; e[6] = (yz + wx) * s.Y; e[7] = 0;
            e[8] = (xz + wy) * s.Z; e[9] = (yz - wx) * s.Z; e[10] = (1 - (xx + yy)) * s.Z; e[11] = 0;
            e[12] = p.X; e[13] = p.Y; e[14] = p.Z; e[15] = 1;
            return m;
        }

        // this * b
        public Mat4 Mul(Mat4 b)
        {
            var r = new Mat4();
            for (int col = 0; col < 4; col++)
                for (int row = 0; row < 4; row++)
                {
                    double sum = 0;
                    for (int k = 0; k < 4; k++) sum += E[k * 4 + row] * b.E[col * 4 + k];
                    r.E[col * 4 + row] = sum;
                }
            return r;
        }

        public double Determinant()
        {
            var e = E;
            double n11 = e[0], n21 = e[1], n31 = e[2], n41 = e[3];
            double n12 = e[4], n22 = e[5], n32 = e[6], n42 = e[7];
            double n13 = e[8], n23 = e[9], n33 = e[10], n43 = e[11];
            double n14 = e[12], n24 = e[13], n34 = e[14], n44 = e[15];
            return n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34)
                 + n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31)
                 + n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31)
                 + n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31);
        }

        // The inverse (three's Matrix4.invert); the zero matrix if it is singular.
        public Mat4 Inverse()
        {
            var te = E;
            double n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3];
            double n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7];
            double n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11];
            double n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15];
            double t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
            double t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
            double t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
            double t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
            double det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
            var r = new Mat4();
            if (det == 0) return r;
            double d = 1 / det;
            var o = r.E;
            o[0] = t11 * d;
            o[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
            o[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
            o[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
            o[4] = t12 * d;
            o[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
            o[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
            o[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
            o[8] = t13 * d;
            o[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
            o[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
            o[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
            o[12] = t14 * d;
            o[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
            o[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
            o[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
            return r;
        }

        public Vec3 TransformPoint(Vec3 p)
        {
            double w = 1 / (E[3] * p.X + E[7] * p.Y + E[11] * p.Z + E[15]);
            return new Vec3(
                (E[0] * p.X + E[4] * p.Y + E[8] * p.Z + E[12]) * w,
                (E[1] * p.X + E[5] * p.Y + E[9] * p.Z + E[13]) * w,
                (E[2] * p.X + E[6] * p.Y + E[10] * p.Z + E[14]) * w);
        }

        // Splits into position, rotation and scale (three's Matrix4.decompose): shear is lost, a mirror goes to the x scale.
        public void Decompose(out Vec3 position, out Quat rotation, out Vec3 scale)
        {
            var te = E;
            double sx = Math.Sqrt(te[0] * te[0] + te[1] * te[1] + te[2] * te[2]);
            double sy = Math.Sqrt(te[4] * te[4] + te[5] * te[5] + te[6] * te[6]);
            double sz = Math.Sqrt(te[8] * te[8] + te[9] * te[9] + te[10] * te[10]);
            if (Determinant() < 0) sx = -sx;
            position = new Vec3(te[12], te[13], te[14]);
            double i = 1 / sx, j = 1 / sy, k = 1 / sz;
            double m11 = te[0] * i, m21 = te[1] * i, m31 = te[2] * i;
            double m12 = te[4] * j, m22 = te[5] * j, m32 = te[6] * j;
            double m13 = te[8] * k, m23 = te[9] * k, m33 = te[10] * k;
            double x, y, z, w;
            double trace = m11 + m22 + m33;
            if (trace > 0)
            {
                double s = 0.5 / Math.Sqrt(trace + 1);
                w = 0.25 / s; x = (m32 - m23) * s; y = (m13 - m31) * s; z = (m21 - m12) * s;
            }
            else if (m11 > m22 && m11 > m33)
            {
                double s = 2 * Math.Sqrt(1 + m11 - m22 - m33);
                w = (m32 - m23) / s; x = 0.25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s;
            }
            else if (m22 > m33)
            {
                double s = 2 * Math.Sqrt(1 + m22 - m11 - m33);
                w = (m13 - m31) / s; x = (m12 + m21) / s; y = 0.25 * s; z = (m23 + m32) / s;
            }
            else
            {
                double s = 2 * Math.Sqrt(1 + m33 - m11 - m22);
                w = (m21 - m12) / s; x = (m13 + m31) / s; y = (m23 + m32) / s; z = 0.25 * s;
            }
            rotation = new Quat(x, y, z, w);
            scale = new Vec3(sx, sy, sz);
        }
    }
}
