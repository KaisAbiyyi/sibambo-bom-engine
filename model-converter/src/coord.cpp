#include "coord.h"
#include <cmath>

namespace Coord {
    SUPoint3D transformPoint(const SUPoint3D& pt, const SUTransformation& tf) {
        SUPoint3D out;
        out.x = pt.x * tf.values[0] + pt.y * tf.values[4] + pt.z * tf.values[8] + tf.values[12];
        out.y = pt.x * tf.values[1] + pt.y * tf.values[5] + pt.z * tf.values[9] + tf.values[13];
        out.z = pt.x * tf.values[2] + pt.y * tf.values[6] + pt.z * tf.values[10] + tf.values[14];
        return out;
    }

    SUVector3D transformNormal(const SUVector3D& normal, const SUTransformation& tf) {
        SUVector3D out;
        out.x = normal.x * tf.values[0] + normal.y * tf.values[4] + normal.z * tf.values[8];
        out.y = normal.x * tf.values[1] + normal.y * tf.values[5] + normal.z * tf.values[9];
        out.z = normal.x * tf.values[2] + normal.y * tf.values[6] + normal.z * tf.values[10];
        
        double len = std::sqrt(out.x*out.x + out.y*out.y + out.z*out.z);
        if (len > 0) { out.x/=len; out.y/=len; out.z/=len; }
        return out;
    }

    SUTransformation multiplyTransforms(const SUTransformation& t1, const SUTransformation& t2) {
        SUTransformation out;
        for (int i = 0; i < 4; ++i) {
            for (int j = 0; j < 4; ++j) {
                out.values[i*4 + j] = 
                    t1.values[i*4 + 0] * t2.values[0*4 + j] +
                    t1.values[i*4 + 1] * t2.values[1*4 + j] +
                    t1.values[i*4 + 2] * t2.values[2*4 + j] +
                    t1.values[i*4 + 3] * t2.values[3*4 + j];
            }
        }
        return out;
    }
}
