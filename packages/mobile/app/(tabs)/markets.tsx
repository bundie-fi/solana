import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function MarketsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 px-4 pt-4">
        <Text className="text-2xl font-bold text-predict-purple mb-2">Markets</Text>
        <Text className="text-gray-400">
          Prediction markets on strategy performance
        </Text>
        {/* TODO: Market cards with YES/NO prices */}
        {/* TODO: LS-LMSR implied probability display */}
        {/* TODO: Recent settlements section */}
      </View>
    </SafeAreaView>
  );
}
