// Order Tracker - Line-item geometry helpers
//
// Extracted from line-items.js. Pure functions (no DOM, no shared state):
// parse inch/fraction strings, convert between a WWHH callout and width/height,
// and the door rough-opening <-> nominal-size math.

function parseInchesValue(raw) {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim();
    if (!text) return null;

    // Accept values like 36, 36", 36 in, etc. and extract first numeric token.
    const match = text.match(/\d+(?:\.\d+)?/);
    if (!match) return null;

    const numeric = Number.parseFloat(match[0]);
    if (!Number.isFinite(numeric)) return null;
    return Math.round(numeric);
}

function calloutToDimensions(calloutRaw) {
    const digits = String(calloutRaw || '').replace(/\D/g, '');
    if (!digits || digits.length < 4) return null;

    // Use first two chars for width and next two for height, matching legacy WWHH usage (e.g. 3068).
    const widthCode = digits.slice(0, 2);
    const heightCode = digits.slice(2, 4);

    const widthFeet = Number.parseInt(widthCode[0], 10);
    const widthInches = Number.parseInt(widthCode.slice(1), 10);
    const heightFeet = Number.parseInt(heightCode[0], 10);
    const heightInches = Number.parseInt(heightCode.slice(1), 10);

    if (![widthFeet, widthInches, heightFeet, heightInches].every(Number.isFinite)) return null;

    return {
        width: String((widthFeet * 12) + widthInches),
        height: String((heightFeet * 12) + heightInches),
    };
}

function dimensionsToCallout(widthRaw, heightRaw) {
    const widthInchesTotal = parseInchesValue(widthRaw);
    const heightInchesTotal = parseInchesValue(heightRaw);
    if (!Number.isFinite(widthInchesTotal) || !Number.isFinite(heightInchesTotal)) return '';

    const widthFeet = Math.floor(widthInchesTotal / 12);
    const widthInches = widthInchesTotal % 12;
    const heightFeet = Math.floor(heightInchesTotal / 12);
    const heightInches = heightInchesTotal % 12;

    // The legacy WWHH callout format cannot safely represent 10" or 11" remainders.
    if (widthInches > 9 || heightInches > 9) return '';

    return `${widthFeet}${widthInches}${heightFeet}${heightInches}`;
}

// Standard single prehung door rough opening: nominal door size + 2" width,
// + 2.25" height. Matches order_tracker.py's calculate_door_rough_opening()
// and the "Standard single prehung" row in rough_openings.json.
const DOOR_ROUGH_OPENING_WIDTH_OFFSET = 2;
const DOOR_ROUGH_OPENING_HEIGHT_OFFSET = 2.25;

function formatInchesWithFraction(value) {
    if (!Number.isFinite(value)) return '';
    const whole = Math.floor(value);
    const fraction = Math.round((value - whole) * 4) / 4;
    if (fraction === 0) return `${whole}"`;
    if (fraction === 0.25) return `${whole}-1/4"`;
    if (fraction === 0.5) return `${whole}-1/2"`;
    if (fraction === 0.75) return `${whole}-3/4"`;
    return `${value.toFixed(2)}"`;
}

function parseInchesValuePrecise(raw) {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim();
    if (!text) return null;

    // Fraction-aware: handles "38", "38\"", "82-1/4\"", "82 1/4" etc. without
    // collapsing the fraction the way parseInchesValue's whole-number rounding does.
    const fractionMatch = text.match(/(\d+(?:\.\d+)?)[\s-]+(\d+)\s*\/\s*(\d+)/);
    if (fractionMatch) {
        const whole = Number.parseFloat(fractionMatch[1]);
        const numerator = Number.parseFloat(fractionMatch[2]);
        const denominator = Number.parseFloat(fractionMatch[3]);
        if (Number.isFinite(whole) && Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
            return whole + (numerator / denominator);
        }
    }

    const match = text.match(/\d+(?:\.\d+)?/);
    if (!match) return null;
    const numeric = Number.parseFloat(match[0]);
    return Number.isFinite(numeric) ? numeric : null;
}

function calculateDoorRoughOpeningDimensions(nominalWidthRaw, nominalHeightRaw) {
    const width = parseInchesValuePrecise(nominalWidthRaw);
    const height = parseInchesValuePrecise(nominalHeightRaw);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;

    return {
        width: formatInchesWithFraction(width + DOOR_ROUGH_OPENING_WIDTH_OFFSET),
        height: formatInchesWithFraction(height + DOOR_ROUGH_OPENING_HEIGHT_OFFSET),
    };
}

function reverseDoorRoughOpeningDimensions(roWidthRaw, roHeightRaw) {
    const width = parseInchesValuePrecise(roWidthRaw);
    const height = parseInchesValuePrecise(roHeightRaw);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;

    return {
        width: String(width - DOOR_ROUGH_OPENING_WIDTH_OFFSET),
        height: String(height - DOOR_ROUGH_OPENING_HEIGHT_OFFSET),
    };
}
