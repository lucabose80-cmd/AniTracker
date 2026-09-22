import { UserWork, EmotionalImpact, WatchMode } from "@/types/database";

interface ScoringParams {
  evaluation: UserWork["evaluation"];
  hasRomance: boolean;
  isRomanceMainFocus: boolean;
  isAnime: boolean;
  watchMode: WatchMode;
}

export function calculateOverallScore({
  evaluation,
  hasRomance,
  isRomanceMainFocus,
  isAnime,
  watchMode,
}: ScoringParams): number {
  let totalWeightedScore = 0;
  let totalWeights = 0;

  const addScore = (score: number, weight: number) => {
    if (score > 0) { // Only count if a score is actually given (assuming 1-10 scale)
      totalWeightedScore += score * weight;
      totalWeights += weight;
    }
  };

  // Story: x2.0
  addScore(evaluation.plotAndStory, 2.0);
  
  // Cast Main: x2.0
  addScore(evaluation.castAndCharacters, 2.0);
  
  // Side Characters: x1.0
  addScore(evaluation.sideCharacters, 1.0);
  
  // Artstyle: x1.5
  addScore(evaluation.artstyleAndAnimation, 1.5);
  
  // Ending: x1.5 (immer)
  addScore(evaluation.ending, 1.5);
  
  // Binge-Factor: x1.0
  addScore(evaluation.bingeFactor, 1.0);

  // Comedy: x1.0
  if (evaluation.comedy) {
    addScore(evaluation.comedy, 1.0);
  }
  
  // Romance: x1.0 (subplot) OR x2.0 (main focus)
  if (hasRomance) {
    const romanceWeight = isRomanceMainFocus ? 2.0 : 1.0;
    addScore(evaluation.romanceAndChemistry, romanceWeight);
  }
  
  // Intro/Outro: x0.5 (Anime only)
  if (isAnime) {
    addScore(evaluation.introOutro, 0.5);
  }
  
  // Voice Acting: x0.5 (Dub only)
  if (watchMode === "DUB" || watchMode === "BEIDES") {
    addScore(evaluation.voiceActing, 0.5);
  }

  // Calculate Base Average
  let baseScore = totalWeights > 0 ? totalWeightedScore / totalWeights : 0;

  // Emotional Bonus
  const emotionalBonusMap: Record<EmotionalImpact, number> = {
    "Leicht": 0.1,
    "Mitgenommen": 0.3,
    "Tränen nah": 0.5,
    "Tränen ausgelöst": 0.8,
    "Geweint": 1.2,
    "None": 0.0
  };
  
  const bonus = emotionalBonusMap[evaluation.emotionalImpact] || 0.0;
  
  let finalScore = baseScore + bonus;
  
  // Round to 2 decimal places for cleaner display
  return Math.round(finalScore * 100) / 100;
}
