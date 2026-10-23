/**
 * Server-side Face Matching Engine for MobileFaceNet Deep Feature Embeddings.
 * Supports multi-sample enrollment (Max Cosine Similarity aggregation).
 */

export const FACE_MATCH_THRESHOLD = 78.0; // 78.0% score equivalent to Cosine Sim >= 0.78
export const COSINE_SIMILARITY_THRESHOLD = 0.78; // Calibrated security threshold for 128d L2-normalized vectors

/**
 * Computes Cosine Similarity between two L2-normalized feature vectors.
 * Range: -1.0 to 1.0 (for normalized vectors, dot product = cosine similarity).
 */
export function computeCosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || b.length === 0) return 0;
    if (a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        const valA = a[i];
        const valB = b[i];
        dot += valA * valB;
        normA += valA * valA;
        normB += valB * valB;
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom <= 0.00001) return 0;

    return Math.max(-1.0, Math.min(1.0, dot / denom));
}

/**
 * Calculates Euclidean Distance between two vectors: sqrt(sum((a_i - b_i)^2))
 */
export function computeEuclideanDistance(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length || a.length === 0) return 2.0;
    let sumSq = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sumSq += diff * diff;
    }
    return Math.sqrt(sumSq);
}

/**
 * Legacy log-ratio distance similarity calculation for backwards compatibility.
 */
export function computeLegacyFaceSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || b.length === 0) return 0;
    const minLen = Math.min(a.length, b.length);
    let sumSq = 0;
    let count = 0;
    for (let i = 0; i < minLen; i++) {
        const val1 = a[i];
        const val2 = b[i];
        if (val1 > 0 && val2 > 0) {
            const logDiff = Math.min(Math.abs(Math.log(val1) - Math.log(val2)), 1.2);
            sumSq += logDiff * logDiff;
            count++;
        }
    }
    if (count < 5) return 0;
    const rms = Math.sqrt(sumSq / count);
    return Math.exp(-3.5 * rms);
}

/**
 * Computes face match score percent (0-100%) between probe vector and single/multiple enrolled vectors.
 */
export function computeFaceMatchScore(
    probeVector: number[],
    enrolledData: number[] | number[][] | { featureVector?: number[]; embeddings?: number[][] }
): {
    matched: boolean;
    scorePercent: number;
    similarityScore: number;
    distanceScore: number;
    bestSampleIndex: number;
} {
    if (!probeVector || probeVector.length === 0) {
        return { matched: false, scorePercent: 0, similarityScore: 0, distanceScore: 2.0, bestSampleIndex: -1 };
    }

    // Extract list of enrolled vectors
    let enrolledVectors: number[][] = [];
    if (Array.isArray(enrolledData)) {
        if (enrolledData.length > 0 && Array.isArray(enrolledData[0])) {
            enrolledVectors = enrolledData as number[][];
        } else if (enrolledData.length > 0 && typeof enrolledData[0] === 'number') {
            enrolledVectors = [enrolledData as number[]];
        }
    } else if (enrolledData && typeof enrolledData === 'object') {
        if (Array.isArray(enrolledData.embeddings) && Array.isArray(enrolledData.embeddings[0])) {
            enrolledVectors = enrolledData.embeddings;
        } else if (Array.isArray(enrolledData.featureVector) && enrolledData.featureVector.length > 0) {
            enrolledVectors = [enrolledData.featureVector];
        }
    }

    if (enrolledVectors.length === 0) {
        return { matched: false, scorePercent: 0, similarityScore: 0, distanceScore: 2.0, bestSampleIndex: -1 };
    }

    // Check vector dimension: MobileFaceNet embeddings are 128d or 192d.
    const isDeepEmbedding = probeVector.length >= 64;

    let bestSimilarity = -1.0;
    let bestDistance = 2.0;
    let bestIndex = 0;

    for (let idx = 0; idx < enrolledVectors.length; idx++) {
        const enrolled = enrolledVectors[idx];
        if (!enrolled || enrolled.length === 0) continue;

        let similarity = 0;
        let distance = 2.0;

        if (isDeepEmbedding && enrolled.length === probeVector.length) {
            similarity = computeCosineSimilarity(probeVector, enrolled);
            distance = computeEuclideanDistance(probeVector, enrolled);
        } else {
            similarity = computeLegacyFaceSimilarity(probeVector, enrolled);
            distance = Math.max(0, 1.0 - similarity);
        }

        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestDistance = distance;
            bestIndex = idx;
        }
    }

    let scorePercent = 0;
    let matched = false;

    if (isDeepEmbedding) {
        scorePercent = Math.min(100.0, Math.max(0.0, bestSimilarity * 100.0));
        matched = bestSimilarity >= COSINE_SIMILARITY_THRESHOLD;
    } else {
        scorePercent = Math.min(100.0, Math.max(0.0, bestSimilarity * 100.0));
        matched = scorePercent >= FACE_MATCH_THRESHOLD;
    }

    return {
        matched,
        scorePercent: parseFloat(scorePercent.toFixed(2)),
        similarityScore: parseFloat(bestSimilarity.toFixed(4)),
        distanceScore: parseFloat(bestDistance.toFixed(4)),
        bestSampleIndex: bestIndex,
    };
}

export function computeFaceMatchScorePercent(live: number[], enrolled: number[]): number {
    const result = computeFaceMatchScore(live, enrolled);
    return result.scorePercent;
}
