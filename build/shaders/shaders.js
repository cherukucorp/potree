
Potree.Shaders["pointcloud.vs"] = `
precision mediump float;
precision mediump int;




#define max_clip_boxes 30
#define max_clip_polygons 8

attribute vec3 position;
attribute vec3 color;
attribute vec3 normal;
attribute float intensity;
attribute float classification;
attribute float returnNumber;
attribute float numberOfReturns;
attribute float pointSourceID;
attribute vec4 indices;
//attribute float indices;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform bool useOrthographicCamera;

uniform float pcIndex;

//uniform mat4 toModel;

uniform float screenWidth;
uniform float screenHeight;
uniform float fov;
uniform float spacing;
uniform float near;
uniform float far;
uniform float orthoRange;

uniform int clipMode;
#if defined use_clip_box
	uniform mat4 clipBoxes[max_clip_boxes];
#endif

uniform int clipPolygonCount;
uniform int clipPolygonVCount[max_clip_polygons];
uniform vec3 clipPolygons[max_clip_polygons * 8];
uniform mat4 clipPolygonVP[max_clip_polygons];


uniform float heightMin;
uniform float heightMax;
uniform float size;				// pixel size factor
uniform float minSize;			// minimum pixel size
uniform float maxSize;			// maximum pixel size
uniform float octreeSize;
uniform vec3 bbSize;
uniform vec3 uColor;
uniform float opacity;
uniform float clipBoxCount;
uniform float level;
uniform float vnStart;

uniform vec2 intensityRange;
uniform float intensityGamma;
uniform float intensityContrast;
uniform float intensityBrightness;
uniform float rgbGamma;
uniform float rgbContrast;
uniform float rgbBrightness;
uniform float transition;
uniform float wRGB;
uniform float wIntensity;
uniform float wElevation;
uniform float wClassification;
uniform float wReturnNumber;
uniform float wSourceID;


uniform sampler2D visibleNodes;
uniform sampler2D gradient;
uniform sampler2D classificationLUT;
uniform sampler2D depthMap;

varying float	vOpacity;
varying vec3	vColor;
varying float	vLinearDepth;
varying float	vLogDepth;
varying vec3	vViewPosition;
varying float 	vRadius;
varying vec3	vWorldPosition;
varying vec3	vNormal;


// ---------------------
// OCTREE
// ---------------------

#if (defined(adaptive_point_size) || defined(color_type_lod)) && defined(tree_type_octree)
/**
 * number of 1-bits up to inclusive index position
 * number is treated as if it were an integer in the range 0-255
 *
 */
float numberOfOnes(float number, float index){
	float tmp = mod(number, pow(2.0, index + 1.0));
	float numOnes = 0.0;
	for(float i = 0.0; i < 8.0; i++){
		if(mod(tmp, 2.0) != 0.0){
			numOnes++;
		}
		tmp = floor(tmp / 2.0);
	}
	return numOnes;
}


/**
 * checks whether the bit at index is 1
 * number is treated as if it were an integer in the range 0-255
 *
 */
bool isBitSet(float number, float index){
	return mod(floor(number / pow(2.0, index)), 2.0) != 0.0;
}


/**
 * find the LOD at the point position
 */
float getLOD(){
	
	vec3 offset = vec3(0.0, 0.0, 0.0);
	float iOffset = vnStart;
	float depth = level;
	for(float i = 0.0; i <= 30.0; i++){
		float nodeSizeAtLevel = octreeSize  / pow(2.0, i + level + 0.0);
		
		vec3 index3d = (position-offset) / nodeSizeAtLevel;
		index3d = floor(index3d + 0.5);
		float index = 4.0 * index3d.x + 2.0 * index3d.y + index3d.z;
		
		vec4 value = texture2D(visibleNodes, vec2(iOffset / 2048.0, 0.0));
		float mask = value.r * 255.0;
		if(isBitSet(mask, index)){
			// there are more visible child nodes at this position
			iOffset = iOffset + value.g * 255.0 * 256.0 + value.b * 255.0 + numberOfOnes(mask, index - 1.0);
			depth++;
		}else{
			// no more visible child nodes at this position
			return depth;
		}
		
		offset = offset + (vec3(1.0, 1.0, 1.0) * nodeSizeAtLevel * 0.5) * index3d;
        
	}
		
	return depth;
}

float getPointSizeAttenuation(){
	return pow(1.9, getLOD());
}


#endif


// ---------------------
// KD-TREE
// ---------------------

#if (defined(adaptive_point_size) || defined(color_type_lod)) && defined(tree_type_kdtree)

float getLOD(){
	vec3 offset = vec3(0.0, 0.0, 0.0);
	float iOffset = 0.0;
	float depth = 0.0;
		
		
	vec3 size = bbSize;	
	vec3 pos = position;
		
	for(float i = 0.0; i <= 1000.0; i++){
		
		vec4 value = texture2D(visibleNodes, vec2(iOffset / 2048.0, 0.0));
		
		int children = int(value.r * 255.0);
		float next = value.g * 255.0;
		int split = int(value.b * 255.0);
		
		if(next == 0.0){
		 	return depth;
		}
		
		vec3 splitv = vec3(0.0, 0.0, 0.0);
		if(split == 1){
			splitv.x = 1.0;
		}else if(split == 2){
		 	splitv.y = 1.0;
		}else if(split == 4){
		 	splitv.z = 1.0;
		}
		
		iOffset = iOffset + next;
		
		float factor = length(pos * splitv / size);
		if(factor < 0.5){
		 	// left
		    if(children == 0 || children == 2){
		    	return depth;
		    }
		}else{
		  	// right
		    pos = pos - size * splitv * 0.5;
		    if(children == 0 || children == 1){
		    	return depth;
		    }
		    if(children == 3){
		    	iOffset = iOffset + 1.0;
		    }
		}
		size = size * ((1.0 - (splitv + 1.0) / 2.0) + 0.5);
		
		depth++;
	}
		
		
	return depth;	
}

float getPointSizeAttenuation(){
	return 0.5 * pow(1.3, getLOD());
}

#endif

// formula adapted from: http://www.dfstudios.co.uk/articles/programming/image-programming-algorithms/image-processing-algorithms-part-5-contrast-adjustment/
float getContrastFactor(float contrast){
	return (1.0158730158730156 * (contrast + 1.0)) / (1.0158730158730156 - contrast);
}

vec3 getRGB(){
	vec3 rgb = color;
	
	rgb = pow(rgb, vec3(rgbGamma));
	rgb = rgb + rgbBrightness;
	rgb = (rgb - 0.5) * getContrastFactor(rgbContrast) + 0.5;
	rgb = clamp(rgb, 0.0, 1.0);
	
	//rgb = indices.rgb;
	//rgb.b = pcIndex / 255.0;
	
	
	return rgb;
}

float getIntensity(){
	float w = (intensity - intensityRange.x) / (intensityRange.y - intensityRange.x);
	w = pow(w, intensityGamma);
	w = w + intensityBrightness;
	w = (w - 0.5) * getContrastFactor(intensityContrast) + 0.5;
	w = clamp(w, 0.0, 1.0);
	
	return w;
}

vec3 getElevation(){
	vec4 world = modelMatrix * vec4( position, 1.0 );
	float w = (world.z - heightMin) / (heightMax-heightMin);
	vec3 cElevation = texture2D(gradient, vec2(w,1.0-w)).rgb;
	
	return cElevation;
}

vec4 getClassification(){
	vec2 uv = vec2(classification / 255.0, 0.5);
	vec4 classColor = texture2D(classificationLUT, uv);
	
	return classColor;
}

vec3 getReturnNumber(){
	if(numberOfReturns == 1.0){
		return vec3(1.0, 1.0, 0.0);
	}else{
		if(returnNumber == 1.0){
			return vec3(1.0, 0.0, 0.0);
		}else if(returnNumber == numberOfReturns){
			return vec3(0.0, 0.0, 1.0);
		}else{
			return vec3(0.0, 1.0, 0.0);
		}
	}
}

vec3 getSourceID(){
	float w = mod(pointSourceID, 10.0) / 10.0;
	return texture2D(gradient, vec2(w,1.0 - w)).rgb;
}

vec3 getCompositeColor(){
	vec3 c;
	float w;

	c += wRGB * getRGB();
	w += wRGB;
	
	c += wIntensity * getIntensity() * vec3(1.0, 1.0, 1.0);
	w += wIntensity;
	
	c += wElevation * getElevation();
	w += wElevation;
	
	c += wReturnNumber * getReturnNumber();
	w += wReturnNumber;
	
	c += wSourceID * getSourceID();
	w += wSourceID;
	
	vec4 cl = wClassification * getClassification();
    c += cl.a * cl.rgb;
	w += wClassification * cl.a;

	c = c / w;
	
	if(w == 0.0){
		//c = color;
		gl_Position = vec4(100.0, 100.0, 100.0, 0.0);
	}
	
	return c;
}

bool pointInClipPolygon(vec3 point, int polyIdx) {
	vec4 screenClipPos = clipPolygonVP[polyIdx] * modelMatrix * vec4(point, 1.0);
	screenClipPos.xy = screenClipPos.xy / screenClipPos.w * 0.5 + 0.5;

	int j = clipPolygonVCount[polyIdx] - 1;
	bool c = false;
	for(int i = 0; i < 8; i++) {
		if(i == clipPolygonVCount[polyIdx]) {
			break;
		}

		vec4 verti = clipPolygonVP[polyIdx] * vec4(clipPolygons[polyIdx * 8 + i], 1);
		vec4 vertj = clipPolygonVP[polyIdx] * vec4(clipPolygons[polyIdx * 8 + j], 1);
		verti.xy = verti.xy / verti.w * 0.5 + 0.5;
		vertj.xy = vertj.xy / vertj.w * 0.5 + 0.5;
		if( ((verti.y > screenClipPos.y) != (vertj.y > screenClipPos.y)) && 
			(screenClipPos.x < (vertj.x-verti.x) * (screenClipPos.y-verti.y) / (vertj.y-verti.y) + verti.x) ) {
			c = !c;
		}
		j = i;
	}

	return c;
}

void testInsideClipVolume(bool inside) {
	if(inside && clipMode == 2 || !inside && clipMode == 3) {
		gl_Position = vec4(1000.0, 1000.0, 1000.0, 1.0);
	} else if(clipMode == 1 && inside) {
		vColor.r += 0.5;
	}
}

void main() {
	vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
	vViewPosition = mvPosition.xyz;
	gl_Position = projectionMatrix * mvPosition;
	vOpacity = opacity;
	vLinearDepth = gl_Position.w;
	vLogDepth = log2(-mvPosition.z);
	vNormal = normalize(normalMatrix * normal);

	// ---------------------
	// POINT COLOR
	// ---------------------
	vec4 cl = getClassification(); 
	
	#ifdef color_type_rgb
		vColor = getRGB();
	#elif defined color_type_height
		vColor = getElevation();
	#elif defined color_type_rgb_height
		vec3 cHeight = getElevation();
		vColor = (1.0 - transition) * getRGB() + transition * cHeight;
	#elif defined color_type_depth
		float linearDepth = -mvPosition.z ;
		float expDepth = (gl_Position.z / gl_Position.w) * 0.5 + 0.5;
		vColor = vec3(linearDepth, expDepth, 0.0);
	#elif defined color_type_intensity
		float w = getIntensity();
		vColor = vec3(w, w, w);
	#elif defined color_type_intensity_gradient
		float w = getIntensity();
		vColor = texture2D(gradient, vec2(w,1.0-w)).rgb;
	#elif defined color_type_color
		vColor = uColor;
	#elif defined color_type_lod
		float depth = getLOD();
		float w = depth / 5.0;
		vColor = texture2D(gradient, vec2(w,1.0-w)).rgb;
	#elif defined color_type_point_index
		//vColor = indices.rgb * 255.0;
		vColor = indices.rgb;
		
		//vColor.r = mod(indices, 256.0) / 255.0;
		//vColor.g = mod(indices / 256.0, 256.0) / 255.0;
		//vColor.b = 0.0;
		
	#elif defined color_type_classification
		vColor = cl.rgb;
	#elif defined color_type_return_number
		vColor = getReturnNumber();
	#elif defined color_type_source
		vColor = getSourceID();
	#elif defined color_type_normal
		vColor = (modelMatrix * vec4(normal, 0.0)).xyz;
	#elif defined color_type_phong
		vColor = color;
	#elif defined color_type_composite
		vColor = getCompositeColor();
	#endif
	
	#if !defined color_type_composite
		if(cl.a == 0.0){
			gl_Position = vec4(100.0, 100.0, 100.0, 0.0);
			
			return;
		}
	#endif
	
	// ---------------------
	// POINT SIZE
	// ---------------------
	float pointSize = 1.0;
	
	float slope = tan(fov / 2.0);
	float projFactor =  -0.5 * screenHeight / (slope * vViewPosition.z);
	
	float r = spacing * 1.5;
	vRadius = r;
	#if defined fixed_point_size
		pointSize = size;
	#elif defined attenuated_point_size
		pointSize = size;
		if(!useOrthographicCamera)
			pointSize = pointSize * projFactor;
	#elif defined adaptive_point_size
		if(useOrthographicCamera) {
			pointSize = size * r / (orthoRange * pow(2.0, getLOD())) * screenWidth;
		} else {
			float worldSpaceSize = size * r / getPointSizeAttenuation();
			pointSize = worldSpaceSize * projFactor;
		}
	#endif

	pointSize = max(minSize, pointSize);
	pointSize = min(maxSize, pointSize);
	
	vRadius = pointSize / projFactor;
	
	gl_PointSize = pointSize;
	
	
	// ---------------------
	// CLIPPING
	// ---------------------
	
	#if defined use_clip_box
		if(clipMode != 0) {
			bool insideAny = false;
			for(int i = 0; i < max_clip_boxes; i++){
				if(i == int(clipBoxCount)){
					break;
				}
			
				vec4 clipPosition = clipBoxes[i] * modelMatrix * vec4( position, 1.0 );
				bool inside = -0.5 <= clipPosition.x && clipPosition.x <= 0.5;
				inside = inside && -0.5 <= clipPosition.y && clipPosition.y <= 0.5;
				inside = inside && -0.5 <= clipPosition.z && clipPosition.z <= 0.5;
				insideAny = insideAny || inside;
			}	
			testInsideClipVolume(insideAny);
		}
	#endif

	#if defined use_clip_polygon
		if(clipMode != 0) {
			bool polyInsideAny = false;
			for(int i = 0; i < max_clip_polygons; i++) {
				if(i == clipPolygonCount) {
					break;
				}

				polyInsideAny = polyInsideAny || pointInClipPolygon(position, i);
			}
			testInsideClipVolume(polyInsideAny);
		}
	#endif	
}
`

Potree.Shaders["pointcloud.fs"] = `
precision mediump float;
precision mediump int;

#if defined paraboloid_point_shape
	#extension GL_EXT_frag_depth : enable
#endif

uniform mat4 viewMatrix;
uniform vec3 cameraPosition;


uniform mat4 projectionMatrix;
uniform float opacity;

uniform float blendHardness;
uniform float blendDepthSupplement;
uniform float fov;
uniform float spacing;
uniform float near;
uniform float far;
uniform float pcIndex;
uniform float screenWidth;
uniform float screenHeight;

uniform sampler2D depthMap;

varying vec3	vColor;
varying float	vOpacity;
varying float	vLinearDepth;
varying float	vLogDepth;
varying vec3	vViewPosition;
varying float	vRadius;
varying vec3	vNormal;

float specularStrength = 1.0;

void main() {

	vec3 color = vColor;
	float depth = gl_FragCoord.z;

	#if defined(circle_point_shape) || defined(paraboloid_point_shape) || defined (weighted_splats)
		float u = 2.0 * gl_PointCoord.x - 1.0;
		float v = 2.0 * gl_PointCoord.y - 1.0;
	#endif
	
	#if defined(circle_point_shape) || defined (weighted_splats)
		float cc = u*u + v*v;
		if(cc > 1.0){
			discard;
		}
	#endif
	
	#if defined weighted_splats
		vec2 uv = gl_FragCoord.xy / vec2(screenWidth, screenHeight);
		float sDepth = texture2D(depthMap, uv).r;
		if(vLinearDepth > sDepth + vRadius + blendDepthSupplement){
			discard;
		}
	#endif
		
	#if defined color_type_point_index
		gl_FragColor = vec4(color, pcIndex / 255.0);
	#else
		gl_FragColor = vec4(color, vOpacity);
	#endif

	vec3 normal = normalize( vNormal );
	normal.z = abs(normal.z);
	vec3 viewPosition = normalize( vViewPosition );
	
	#if defined(color_type_phong)

	// code taken from three.js phong light fragment shader
	
		#if MAX_POINT_LIGHTS > 0

			vec3 pointDiffuse = vec3( 0.0 );
			vec3 pointSpecular = vec3( 0.0 );

			for ( int i = 0; i < MAX_POINT_LIGHTS; i ++ ) {

				vec4 lPosition = viewMatrix * vec4( pointLightPosition[ i ], 1.0 );
				vec3 lVector = lPosition.xyz + vViewPosition.xyz;

				float lDistance = 1.0;
				if ( pointLightDistance[ i ] > 0.0 )
					lDistance = 1.0 - min( ( length( lVector ) / pointLightDistance[ i ] ), 1.0 );

				lVector = normalize( lVector );

						// diffuse

				float dotProduct = dot( normal, lVector );

				#ifdef WRAP_AROUND

					float pointDiffuseWeightFull = max( dotProduct, 0.0 );
					float pointDiffuseWeightHalf = max( 0.5 * dotProduct + 0.5, 0.0 );

					vec3 pointDiffuseWeight = mix( vec3( pointDiffuseWeightFull ), vec3( pointDiffuseWeightHalf ), wrapRGB );

				#else

					float pointDiffuseWeight = max( dotProduct, 0.0 );

				#endif

				pointDiffuse += diffuse * pointLightColor[ i ] * pointDiffuseWeight * lDistance;

						// specular

				vec3 pointHalfVector = normalize( lVector + viewPosition );
				float pointDotNormalHalf = max( dot( normal, pointHalfVector ), 0.0 );
				float pointSpecularWeight = specularStrength * max( pow( pointDotNormalHalf, shininess ), 0.0 );

				float specularNormalization = ( shininess + 2.0 ) / 8.0;

				vec3 schlick = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( lVector, pointHalfVector ), 0.0 ), 5.0 );
				pointSpecular += schlick * pointLightColor[ i ] * pointSpecularWeight * pointDiffuseWeight * lDistance * specularNormalization;
				pointSpecular = vec3(0.0, 0.0, 0.0);
			}
		
		#endif
		
		#if MAX_DIR_LIGHTS > 0

			vec3 dirDiffuse = vec3( 0.0 );
			vec3 dirSpecular = vec3( 0.0 );

			for( int i = 0; i < MAX_DIR_LIGHTS; i ++ ) {

				vec4 lDirection = viewMatrix * vec4( directionalLightDirection[ i ], 0.0 );
				vec3 dirVector = normalize( lDirection.xyz );

						// diffuse

				float dotProduct = dot( normal, dirVector );

				#ifdef WRAP_AROUND

					float dirDiffuseWeightFull = max( dotProduct, 0.0 );
					float dirDiffuseWeightHalf = max( 0.5 * dotProduct + 0.5, 0.0 );

					vec3 dirDiffuseWeight = mix( vec3( dirDiffuseWeightFull ), vec3( dirDiffuseWeightHalf ), wrapRGB );

				#else

					float dirDiffuseWeight = max( dotProduct, 0.0 );

				#endif

				dirDiffuse += diffuse * directionalLightColor[ i ] * dirDiffuseWeight;

				// specular

				vec3 dirHalfVector = normalize( dirVector + viewPosition );
				float dirDotNormalHalf = max( dot( normal, dirHalfVector ), 0.0 );
				float dirSpecularWeight = specularStrength * max( pow( dirDotNormalHalf, shininess ), 0.0 );

				float specularNormalization = ( shininess + 2.0 ) / 8.0;

				vec3 schlick = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( dirVector, dirHalfVector ), 0.0 ), 5.0 );
				dirSpecular += schlick * directionalLightColor[ i ] * dirSpecularWeight * dirDiffuseWeight * specularNormalization;
			}

		#endif
		
		vec3 totalDiffuse = vec3( 0.0 );
		vec3 totalSpecular = vec3( 0.0 );
		
		#if MAX_POINT_LIGHTS > 0

			totalDiffuse += pointDiffuse;
			totalSpecular += pointSpecular;

		#endif
		
		#if MAX_DIR_LIGHTS > 0

			totalDiffuse += dirDiffuse;
			totalSpecular += dirSpecular;

		#endif
		
		gl_FragColor.xyz = gl_FragColor.xyz * ( emissive + totalDiffuse + ambientLightColor * ambient ) + totalSpecular;

	#endif
	
	#if defined weighted_splats
	    //float w = pow(1.0 - (u*u + v*v), blendHardness);
		
		float wx = 2.0 * length(2.0 * gl_PointCoord - 1.0);
		float w = exp(-wx * wx * 0.5);
		
		//float distance = length(2.0 * gl_PointCoord - 1.0);
		//float w = exp( -(distance * distance) / blendHardness);
		
		gl_FragColor.rgb = gl_FragColor.rgb * w;
		gl_FragColor.a = w;
	#endif
	
	#if defined paraboloid_point_shape
		float wi = 0.0 - ( u*u + v*v);
		vec4 pos = vec4(vViewPosition, 1.0);
		pos.z += wi * vRadius;
		float linearDepth = -pos.z;
		pos = projectionMatrix * pos;
		pos = pos / pos.w;
		float expDepth = pos.z;
		depth = (pos.z + 1.0) / 2.0;
		gl_FragDepthEXT = depth;
		
		#if defined(color_type_depth)
			color.r = linearDepth;
			color.g = expDepth;
		#endif
		
		#if defined(use_edl)
			gl_FragColor.a = log2(linearDepth);
		#endif
		
	#else
		#if defined(use_edl)
			gl_FragColor.a = vLogDepth;
		#endif
	#endif
	
	
		
	
	
	
	
}


`

Potree.Shaders["normalize.vs"] = `
varying vec2 vUv;

void main() {
    vUv = uv;

    gl_Position =   projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`

Potree.Shaders["normalize.fs"] = `
#extension GL_EXT_frag_depth : enable

uniform sampler2D depthMap;
uniform sampler2D texture;

varying vec2 vUv;

void main() {
    float depth = texture2D(depthMap, vUv).g; 
	
	if(depth <= 0.0){
		discard;
	}
	
    vec4 color = texture2D(texture, vUv); 
	color = color / color.w;
    
	gl_FragColor = vec4(color.xyz, 1.0); 
	
	gl_FragDepthEXT = depth;
}`

Potree.Shaders["edl.vs"] = `

varying vec2 vUv;

void main() {
    vUv = uv;
	
	vec4 mvPosition = modelViewMatrix * vec4(position,1.0);

    gl_Position = projectionMatrix * mvPosition;
}`

Potree.Shaders["edl.fs"] = `// 
// adapted from the EDL shader code from Christian Boucheny in cloud compare:
// https://github.com/cloudcompare/trunk/tree/master/plugins/qEDL/shaders/EDL
//

uniform float screenWidth;
uniform float screenHeight;
uniform vec2 neighbours[NEIGHBOUR_COUNT];
uniform float edlStrength;
uniform float radius;
uniform float opacity;

uniform sampler2D colorMap;

varying vec2 vUv;

float response(float depth){
	vec2 uvRadius = radius / vec2(screenWidth, screenHeight);
	
	float sum = 0.0;
	
	for(int i = 0; i < NEIGHBOUR_COUNT; i++){
		vec2 uvNeighbor = vUv + uvRadius * neighbours[i];
		
		float neighbourDepth = texture2D(colorMap, uvNeighbor).a;

		if(neighbourDepth != 0.0){
			if(depth == 0.0){
				sum += 100.0;
			}else{
				sum += max(0.0, depth - neighbourDepth);
			}
		}
	}
	
	return sum / float(NEIGHBOUR_COUNT);
}

void main(){
	vec4 color = texture2D(colorMap, vUv);
	
	float depth = color.a;
	float res = response(depth);
	float shade = exp(-res * 300.0 * edlStrength);
	
	if(color.a == 0.0 && res == 0.0){
		discard;
	}else{
		gl_FragColor = vec4(color.rgb * shade, opacity);
	}
	
}
`

Potree.Shaders["blur.vs"] = `
varying vec2 vUv;

void main() {
    vUv = uv;

    gl_Position =   projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`

Potree.Shaders["blur.fs"] = `
uniform mat4 projectionMatrix;

uniform float screenWidth;
uniform float screenHeight;
uniform float near;
uniform float far;

uniform sampler2D map;

varying vec2 vUv;

void main() {

	float dx = 1.0 / screenWidth;
	float dy = 1.0 / screenHeight;

	vec3 color = vec3(0.0, 0.0, 0.0);
	color += texture2D(map, vUv + vec2(-dx, -dy)).rgb;
	color += texture2D(map, vUv + vec2(  0, -dy)).rgb;
	color += texture2D(map, vUv + vec2(+dx, -dy)).rgb;
	color += texture2D(map, vUv + vec2(-dx,   0)).rgb;
	color += texture2D(map, vUv + vec2(  0,   0)).rgb;
	color += texture2D(map, vUv + vec2(+dx,   0)).rgb;
	color += texture2D(map, vUv + vec2(-dx,  dy)).rgb;
	color += texture2D(map, vUv + vec2(  0,  dy)).rgb;
	color += texture2D(map, vUv + vec2(+dx,  dy)).rgb;
    
	color = color / 9.0;
	
	gl_FragColor = vec4(color, 1.0);
	
	
}`
