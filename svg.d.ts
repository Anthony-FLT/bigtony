// Déclaration de types pour react-native-svg-transformer.
// Sans ce fichier, TypeScript ne sait pas qu'un import ".svg" est un composant React valide
// (le bundler Metro, lui, sait déjà le transformer — ce fichier ne fait que satisfaire TypeScript).
declare module "*.svg" {
  import React from "react";
  import { SvgProps } from "react-native-svg";
  const content: React.FC<SvgProps>;
  export default content;
}