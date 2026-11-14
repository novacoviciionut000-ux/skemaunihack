/**
 * Real-Time Turn-by-Turn Navigation Engine for AccessMap
 * Analyzes route polylines to generate maneuver steps, tracks user progress
 * along the route in real-time, calculates distance-to-next-turn, remaining ETA,
 * off-route deviations, and triggers spoken Romanian voice guidance.
 */

/**
 * Calculates distance in meters between two lat/lng coordinates (Haversine formula).
 */
export function getDistanceMeters(p1, p2) {
  if (!p1 || !p2) return 0;
  const lat1 = typeof p1.lat === 'number' ? p1.lat : p1[0];
  const lng1 = typeof p1.lng === 'number' ? p1.lng : p1[1];
  const lat2 = typeof p2.lat === 'number' ? p2.lat : p2[0];
  const lng2 = typeof p2.lng === 'number' ? p2.lng : p2[1];

  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Computes the initial bearing (in degrees [0, 360)) from p1 to p2.
 */
export function getBearing(p1, p2) {
  const lat1 = ((typeof p1.lat === 'number' ? p1.lat : p1[0]) * Math.PI) / 180;
  const lng1 = ((typeof p1.lng === 'number' ? p1.lng : p1[1]) * Math.PI) / 180;
  const lat2 = ((typeof p2.lat === 'number' ? p2.lat : p2[0]) * Math.PI) / 180;
  const lng2 = ((typeof p2.lng === 'number' ? p2.lng : p2[1]) * Math.PI) / 180;

  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

/**
 * Normalizes an angle difference to [-180, 180].
 */
function normalizeAngleDiff(diff) {
  let d = (diff + 180) % 360;
  if (d < 0) d += 360;
  return d - 180;
}

/**
 * Categorizes a turn angle (in degrees) into a maneuver type and Romanian text.
 */
function classifyTurn(angleDiff) {
  if (Math.abs(angleDiff) <= 18) {
    return { maneuver: 'straight', labelRo: 'Continuă drept înainte', shortRo: 'Drept înainte' };
  }
  if (angleDiff > 18 && angleDiff <= 48) {
    return { maneuver: 'slight_right', labelRo: 'Ține ușor spre dreapta', shortRo: 'Ușor dreapta' };
  }
  if (angleDiff > 48 && angleDiff <= 125) {
    return { maneuver: 'turn_right', labelRo: 'Virează la dreapta', shortRo: 'La dreapta' };
  }
  if (angleDiff > 125) {
    return { maneuver: 'sharp_right', labelRo: 'Virează strâns la dreapta', shortRo: 'Strâns dreapta' };
  }
  if (angleDiff < -18 && angleDiff >= -48) {
    return { maneuver: 'slight_left', labelRo: 'Ține ușor spre stânga', shortRo: 'Ușor stânga' };
  }
  if (angleDiff < -48 && angleDiff >= -125) {
    return { maneuver: 'turn_left', labelRo: 'Virează la stânga', shortRo: 'La stânga' };
  }
  return { maneuver: 'sharp_left', labelRo: 'Virează strâns la stânga', shortRo: 'Strâns stânga' };
}

/**
 * Generates turn-by-turn navigation steps from route polyline coordinates [[lat, lng], ...].
 */
export function buildNavigationSteps(coordinates) {
  if (!coordinates || coordinates.length < 2) return [];

  const steps = [];
  let currentStep = {
    id: 0,
    coordIndex: 0,
    coordinate: coordinates[0],
    maneuver: 'depart',
    instructionRo: 'Pornește pe traseu',
    shortRo: 'Pornește',
    distanceMeters: 0,
    targetBearing: getBearing(coordinates[0], coordinates[1]),
  };

  let accumulatedDist = 0;
  let prevBearing = currentStep.targetBearing;

  for (let i = 1; i < coordinates.length; i++) {
    const prevCoord = coordinates[i - 1];
    const currCoord = coordinates[i];
    const segDist = getDistanceMeters(prevCoord, currCoord);
    accumulatedDist += segDist;

    const nextCoord = coordinates[i + 1];
    if (!nextCoord) {
      // Last coordinate: Arrival
      currentStep.distanceMeters = Math.round(accumulatedDist);
      steps.push(currentStep);

      steps.push({
        id: steps.length,
        coordIndex: i,
        coordinate: currCoord,
        maneuver: 'arrive',
        instructionRo: 'Ai sosit la destinație!',
        shortRo: 'Destinație',
        distanceMeters: 0,
        targetBearing: prevBearing,
      });
      break;
    }

    const nextBearing = getBearing(currCoord, nextCoord);
    const angleDiff = normalizeAngleDiff(nextBearing - prevBearing);

    // If turn angle is significant (> 22 deg) and segment was at least 8 meters, trigger a new step
    if (Math.abs(angleDiff) >= 22 && accumulatedDist >= 8) {
      currentStep.distanceMeters = Math.round(accumulatedDist);
      steps.push(currentStep);

      const turn = classifyTurn(angleDiff);
      currentStep = {
        id: steps.length,
        coordIndex: i,
        coordinate: currCoord,
        maneuver: turn.maneuver,
        instructionRo: turn.labelRo,
        shortRo: turn.shortRo,
        distanceMeters: 0,
        targetBearing: nextBearing,
      };
      accumulatedDist = 0;
      prevBearing = nextBearing;
    }
  }

  // Ensure first step instruction is well worded
  if (steps.length > 0 && steps[0].maneuver === 'depart') {
    steps[0].instructionRo = `Pornește drept înainte pe traseu`;
  }

  return steps;
}

/**
 * Finds the closest point on the route polyline to the given user coordinate,
 * returning the index and distance in meters to the line.
 */
export function findClosestPointOnRoute(userPos, coordinates) {
  if (!userPos || !coordinates || coordinates.length === 0) {
    return { closestIndex: 0, distanceOffRoute: 0, point: coordinates?.[0] || null };
  }

  let minDistance = Infinity;
  let closestIndex = 0;

  for (let i = 0; i < coordinates.length; i++) {
    const d = getDistanceMeters(userPos, coordinates[i]);
    if (d < minDistance) {
      minDistance = d;
      closestIndex = i;
    }
  }

  return {
    closestIndex,
    distanceOffRoute: Math.round(minDistance),
    point: coordinates[closestIndex],
  };
}

/**
 * Evaluates real-time progress of the user along the navigation steps.
 * Returns active maneuver, distance to next turn, remaining route distance,
 * remaining time, off-route warning, and spoken prompt text.
 */
export function getLiveGuidanceStatus({
  userLocation,
  steps,
  coordinates,
  speedMps = 1.2, // ~4.3 km/h pedestrian speed
}) {
  if (!userLocation || !steps || steps.length === 0 || !coordinates) {
    return null;
  }

  const { closestIndex, distanceOffRoute } = findClosestPointOnRoute(userLocation, coordinates);
  const isOffRoute = distanceOffRoute > 40; // >40m deviation

  // Find the upcoming step that lies ahead of the user's current progress
  let activeStepIndex = 0;
  for (let s = 0; s < steps.length; s++) {
    if (steps[s].coordIndex > closestIndex) {
      activeStepIndex = s;
      break;
    }
    activeStepIndex = s;
  }

  const activeStep = steps[activeStepIndex] || steps[steps.length - 1];
  const nextStep = steps[activeStepIndex + 1] || null;

  // Calculate distance remaining to the active maneuver
  const distToManeuver = Math.round(getDistanceMeters(userLocation, activeStep.coordinate));

  // Calculate total remaining distance from user to destination along the polyline
  let remainingDist = getDistanceMeters(userLocation, coordinates[closestIndex]);
  for (let i = closestIndex; i < coordinates.length - 1; i++) {
    remainingDist += getDistanceMeters(coordinates[i], coordinates[i + 1]);
  }
  remainingDist = Math.round(remainingDist);
  const remainingSeconds = Math.max(1, Math.round(remainingDist / speedMps));

  // Determine spoken voice prompt based on proximity to maneuver
  let voicePrompt = null;
  let isImminent = false;

  if (isOffRoute) {
    voicePrompt = 'Atenție, ai deviat de la traseu! Reorientează-te spre trotuar.';
  } else if (activeStep.maneuver === 'arrive' && distToManeuver <= 15) {
    voicePrompt = 'Ai sosit la destinație!';
    isImminent = true;
  } else if (distToManeuver <= 15) {
    voicePrompt = `Acum, ${activeStep.instructionRo.toLowerCase()}`;
    isImminent = true;
  } else if (distToManeuver <= 40) {
    voicePrompt = `În ${distToManeuver} metri, ${activeStep.instructionRo.toLowerCase()}`;
  } else if (distToManeuver <= 85) {
    voicePrompt = `Peste ${distToManeuver} metri, ${activeStep.instructionRo.toLowerCase()}`;
  } else {
    voicePrompt = `${activeStep.instructionRo}, continuă ${distToManeuver} metri`;
  }

  return {
    activeStep,
    activeStepIndex,
    nextStep,
    distToManeuver,
    remainingDist,
    remainingSeconds,
    distanceOffRoute,
    isOffRoute,
    isImminent,
    voicePrompt,
    closestIndex,
  };
}
