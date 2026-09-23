// Config Metro par défaut d'Expo, enrichie pour que react-native-svg-transformer
// permette d'importer un .svg directement comme un composant React :
//   import MonIllustration from "./assets/scenes/exemple.svg";
//   <MonIllustration width={230} height={150} />
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const { transformer, resolver } = config;

config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve("react-native-svg-transformer"),
};
config.resolver = {
  ...resolver,
  // .svg n'est plus traité comme un asset brut (image) ...
  assetExts: resolver.assetExts.filter((ext) => ext !== "svg"),
  // ... mais comme un fichier source (transformé en composant par le transformer ci-dessus)
  sourceExts: [...resolver.sourceExts, "svg"],
};

module.exports = config;