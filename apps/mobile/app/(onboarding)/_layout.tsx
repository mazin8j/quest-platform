import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="verify-email" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="interests" />
    </Stack>
  );
}
