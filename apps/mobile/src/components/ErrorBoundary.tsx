import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { spacing, themes, typography } from '../theme';

interface Props {
  children: ReactNode;
  /** Hook for crash reporting (wired in observability hardening). Never receives PII by contract. */
  onError?: (error: Error, info: ErrorInfo) => void;
}
interface State {
  hasError: boolean;
}

/** Top-level React error boundary: shows a recoverable screen instead of a white crash. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private reset = () => this.setState({ hasError: false });

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    const t = themes.light; // boundary must not depend on hooks
    return (
      <View style={[styles.container, { backgroundColor: t.background }]} accessibilityRole="alert">
        <Text style={[styles.title, { color: t.textPrimary }]}>Something went wrong</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>Please try again.</Text>
        <Pressable
          onPress={this.reset}
          style={[styles.button, { backgroundColor: t.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={[styles.buttonText, { color: t.onPrimary }]}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold },
  body: { fontSize: typography.size.md },
  button: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: 999,
    justifyContent: 'center',
  },
  buttonText: { fontSize: typography.size.md, fontWeight: typography.weight.semibold },
});
