// FinCom's Motion for Arc (vite.config.js points "motion/react" here). An accounting tool moves calmly: every Arc
// component takes the reduced-motion path it already has (a short fade, no travel, no spring, no blur), whatever the
// computer's own setting. Everything else is Motion as it is.
export * from "framer-motion";
export const useReducedMotion = () => true;
