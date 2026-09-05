import { Link } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { Screen } from '@/components/Screen';
import { typography, useTheme } from '@/theme';

export default function NotFoundScreen() {
  const t = useTheme();
  return (
    <Screen>
      <Text style={[styles.title, { color: t.textPrimary }]}>This screen does not exist.</Text>
      <Link href="/" style={{ color: t.primary, fontSize: typography.size.md }}>
        Go home
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.semibold },
});
