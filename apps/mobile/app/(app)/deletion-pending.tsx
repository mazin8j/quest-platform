import { Muted, PrimaryButton, Title, useAction } from '../../src/components/Form';
import { Screen } from '../../src/components/Screen';
import { useAuth } from '../../src/features/auth/AuthProvider';

/** Shown while a deletion request is pending: the only actions are cancel or sign out. */
export default function DeletionPendingScreen() {
  const { state, store } = useAuth();
  const scheduled = state.status === 'signedIn' ? state.account.deletionScheduledFor : null;
  const cancel = useAction(async () => {
    await store.call((api) => api.me.cancelDeletion());
    await store.refreshAccount();
  });

  return (
    <Screen>
      <Title>Deletion scheduled</Title>
      <Muted>
        Your account and profile are hidden and will be permanently deleted on{' '}
        {scheduled ? new Date(scheduled).toLocaleDateString() : 'the scheduled date'}. You can
        cancel until then.
      </Muted>
      <PrimaryButton
        title={cancel.pending ? 'Cancelling…' : 'Keep my account'}
        onPress={() => cancel.run()}
        disabled={cancel.pending}
      />
      <PrimaryButton title="Sign out" onPress={() => void store.signOut()} variant="secondary" />
    </Screen>
  );
}
