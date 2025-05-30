import { updateTransaction } from '@lib/api';
import {
  autoDistribute,
  easyGetColorFromId,
  formatToReadableAmount,
  formatToYnabAmount,
  getSubtransacionCategoryname,
  isSplitTransaction,
  onSubtransactionAmountChangeHandler,
} from '@lib/utils';
import { TransactionClearedStatus, TransactionFlagColor } from 'ynab';
import {
  Action,
  ActionPanel,
  confirmAlert,
  Color,
  Form,
  Icon,
  showToast,
  Toast,
  useNavigation,
  captureException,
} from '@raycast/api';
import { FormValidation, useForm, useLocalStorage } from '@raycast/utils';
import { CurrencyFormat, Period, SaveSubTransactionWithReadableAmounts, TransactionDetail } from '@srcTypes';
import { useEffect, useState } from 'react';
import { useCategoryGroups } from '@hooks/useCategoryGroups';
import { usePayees } from '@hooks/usePayees';
import { useTransactions } from '@hooks/useTransactions';
import { AutoDistributeAction } from '@components/actions/autoDistributeAction';
import { Shortcuts } from '@constants';

interface FormValues {
  date: Date | null;
  amount: string;
  payee_id: string;
  memo?: string;
  categoryList?: string[];
  flag_color?: string;
  subtransactions?: SaveSubTransactionWithReadableAmounts[];
  cleared?: boolean;
  payee_name?: string;
  approved: true;
}

interface TransactionEditFormProps {
  transaction: TransactionDetail;
  forApproval?: boolean;
}

export function TransactionEditForm({ transaction }: TransactionEditFormProps) {
  const { pop } = useNavigation();

  const { value: activeBudgetCurrency } = useLocalStorage<CurrencyFormat | null>('activeBudgetCurrency', null);
  const { value: activeBudgetId = '' } = useLocalStorage<string>('activeBudgetId', '');
  const { value: timeline } = useLocalStorage<Period>('timeline', 'month');

  const { mutate } = useTransactions(activeBudgetId, timeline);
  const {
    data: payees = [{ id: transaction.payee_id ?? '', name: transaction.payee_name ?? '' }],
    isLoading: isLoadingPayees,
  } = usePayees(activeBudgetId || '');
  const { data: categoryGroups, isLoading: isLoadingCategories } = useCategoryGroups(activeBudgetId || '');

  const isLoading = isLoadingCategories || isLoadingPayees;

  const categories = categoryGroups?.flatMap((group) => group.categories).filter((c) => !c.hidden);

  const [selectOwnPayee, setselectOwnPayee] = useState(false);
  const [isTransfer] = useState(false);
  const [amount, setAmount] = useState(() =>
    formatToReadableAmount({ amount: transaction.amount, currency: activeBudgetCurrency, includeSymbol: false }),
  );

  const [subtransactions, setSubtransactions] = useState<SaveSubTransactionWithReadableAmounts[]>(() => {
    return (
      transaction.subtransactions?.map((s) => ({
        ...s,
        amount: formatToReadableAmount({ amount: s.amount, currency: activeBudgetCurrency, includeSymbol: false }),
      })) ?? []
    );
  });

  const [categoryList, setCategoryList] = useState<string[]>(() => {
    if (!categories) return [];
    const initialCategories = transaction.subtransactions?.length
      ? transaction.subtransactions.map((s) => s.category_id ?? '')
      : [transaction.category_id ?? ''];

    return initialCategories.filter((catId) => categories.some((cat) => cat.id === catId));
  });

  // Update categoryList when categories change
  useEffect(() => {
    if (categories) {
      const validCategories = categoryList.filter((catId) => categories.some((cat) => cat.id === catId));
      if (validCategories.length !== categoryList.length) {
        setCategoryList(validCategories);
      }
    }
  }, [categories]); // Only depend on categories

  const currencySymbol = activeBudgetCurrency?.currency_symbol;

  const isReconciled = transaction.cleared === TransactionClearedStatus.Reconciled;
  /* We force the user hand so as not to allow reconciled transactions to be edited */
  useEffect(() => {
    if (isReconciled) {
      confirmAlert({
        title: 'Reconciled Transaction',
        message: 'Reconciled transactions should not be edited in Raynab',
        primaryAction: {
          title: 'Understood',
        },
      }).then(() => pop());
    }
  }, [isReconciled]);

  const { handleSubmit, itemProps } = useForm<FormValues>({
    initialValues: {
      date: new Date(transaction.date),
      amount: formatToReadableAmount({ amount: transaction.amount, locale: false }),
      payee_id: transaction.payee_id ?? '',
      memo: transaction.memo ?? '',
      flag_color: transaction.flag_color?.toString() ?? undefined,
      categoryList: categoryList, // Use the validated category list
    },
    validation: {
      date: FormValidation.Required,
      amount: FormValidation.Required,
      payee_id: (value) => {
        if (!selectOwnPayee && !value) {
          return 'Please select or enter a payee';
        }
      },
      categoryList: (value) => {
        if (!isTransfer && (!value || value.length === 0)) {
          return 'Please add at least one category';
        }
      },
    },
    onSubmit: async (values) => {
      const toast = await showToast({ style: Toast.Style.Animated, title: 'Updating Transaction' });

      try {
        const transactionData = {
          ...values,
          date: (values.date ?? new Date()).toISOString(),
          amount: formatToYnabAmount(values.amount, activeBudgetCurrency),
          approved: true,
          category_id: isTransfer ? null : values.categoryList?.[0] || undefined,
          payee_name: values.payee_id ? undefined : values.payee_name,
          cleared: values.cleared ? TransactionClearedStatus.Cleared : TransactionClearedStatus.Uncleared,
          flag_color: values.flag_color ? (values.flag_color as TransactionFlagColor) : null,
          subtransactions:
            subtransactions.length > 0
              ? subtransactions.map((s) => ({
                  ...s,
                  amount: formatToYnabAmount(s.amount, activeBudgetCurrency),
                }))
              : undefined,
        };

        await mutate(updateTransaction(activeBudgetId, transaction.id, transactionData));
        toast.style = Toast.Style.Success;
        toast.title = 'Transaction updated successfully';
        pop();
      } catch (error) {
        toast.style = Toast.Style.Failure;
        captureException(error);
        toast.title = 'Failed to update transaction';

        if (error instanceof Error) {
          toast.message = error.message;
        }
      }
    },
  });

  const onSubcategoryAmountChange = onSubtransactionAmountChangeHandler({
    amount,
    currency: activeBudgetCurrency,
    subtransactions,
    setSubtransactions,
  });

  const isNewSplitTransaction = subtransactions.length > 0 && !isSplitTransaction(transaction);
  return (
    <Form
      navigationTitle="Edit Transaction"
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Submit" onSubmit={handleSubmit} />
          {subtransactions.length > 1 && !isSplitTransaction(transaction) ? (
            <AutoDistributeAction
              amount={amount}
              currency={activeBudgetCurrency}
              categoryList={categoryList}
              setSubtransactions={setSubtransactions}
            />
          ) : null}
          <Action
            title={selectOwnPayee ? 'Show Payee Dropdown' : 'Show Payee Textfield'}
            onAction={() => {
              setselectOwnPayee((v) => !v);
            }}
            shortcut={Shortcuts.TogglePayeeFieldType}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Edit Transaction"
        text="Change one or more of the following fields to update the transaction. Amounts can be positive or negative."
      />
      <Form.DatePicker {...itemProps.date} title="Date of Transaction" type={Form.DatePicker.Type.Date} />
      <Form.TextField
        {...itemProps.amount}
        title={`Amount ${currencySymbol ? `(${currencySymbol})` : ''}`}
        value={amount}
        onChange={setAmount}
      />
      {selectOwnPayee ? (
        <Form.TextField
          {...itemProps.payee_name}
          title="Payee"
          info="Press Opt+P to select from the list of existing payees"
        />
      ) : (
        <Form.Dropdown
          {...itemProps.payee_id}
          title="Payee"
          isLoading={isLoadingPayees}
          info="Press Opt+P to add a payee not in the list"
        >
          {payees?.map((payee) => <Form.Dropdown.Item key={payee.id} value={payee.id} title={payee.name} />)}
        </Form.Dropdown>
      )}

      {/*
        This form field is special. As we want to support split transactions with a simpler interface
        than the API allows us, we simulate them having the same behavior to the consumer but track
        them with two different states.
      */}
      <Form.TagPicker
        {...itemProps.categoryList}
        title="Category"
        value={categoryList}
        /* At the moment the API doesn't support updating existing split transactions' subtransactions */
        onChange={
          !isSplitTransaction(transaction)
            ? (newCategories) => {
                if (newCategories.length > 1) {
                  const distributedAmounts = autoDistribute(
                    formatToYnabAmount(amount, activeBudgetCurrency),
                    newCategories.length,
                  ).map((amount) =>
                    formatToReadableAmount({ amount, currency: activeBudgetCurrency, includeSymbol: false }),
                  );
                  setCategoryList(newCategories);
                  setSubtransactions(
                    newCategories.map((c, idx) => ({ category_id: c ?? '', amount: distributedAmounts[idx] })),
                  );
                } else {
                  setCategoryList(newCategories);
                  setSubtransactions([]);
                }
              }
            : // eslint-disable-next-line @typescript-eslint/no-empty-function
              () => {}
        }
      >
        {categories ? (
          categories.map((category, idx) => (
            <Form.TagPicker.Item
              key={category.id}
              value={category.id}
              title={category.name}
              icon={{ source: Icon.PlusCircle, tintColor: easyGetColorFromId(idx) }}
            />
          ))
        ) : (
          <Form.TagPicker.Item value="" title="" />
        )}
      </Form.TagPicker>

      {/* We don't want to show split transactions' subtransaction amounts as they won't be updated anyway */}
      {isNewSplitTransaction ? (
        <>
          <Form.Separator />
          {subtransactions.map((transaction, idx) => (
            <Form.TextField
              id={`subtransaction-${idx}`}
              key={transaction.category_id}
              title={getSubtransacionCategoryname(categories, transaction)}
              value={transaction.amount}
              onChange={onSubcategoryAmountChange(transaction)}
            />
          ))}
        </>
      ) : null}

      <Form.Separator />

      <Form.TextArea {...itemProps.memo} title="Memo" placeholder="Enter additional information…" />
      <Form.Dropdown {...itemProps.flag_color} title="Flag Color">
        <Form.Dropdown.Item value="" title="No Flag" icon={{ source: Icon.Dot }} />
        <Form.Dropdown.Item
          value={TransactionFlagColor.Red}
          title="Red"
          icon={{ source: Icon.Dot, tintColor: Color.Red }}
        />
        <Form.Dropdown.Item
          value={TransactionFlagColor.Orange}
          title="Orange"
          icon={{ source: Icon.Dot, tintColor: Color.Orange }}
        />
        <Form.Dropdown.Item
          value={TransactionFlagColor.Yellow}
          title="Yellow"
          icon={{ source: Icon.Dot, tintColor: Color.Yellow }}
        />
        <Form.Dropdown.Item
          value={TransactionFlagColor.Green}
          title="Green"
          icon={{ source: Icon.Dot, tintColor: Color.Green }}
        />
        <Form.Dropdown.Item
          value={TransactionFlagColor.Blue}
          title="Blue"
          icon={{ source: Icon.Dot, tintColor: Color.Blue }}
        />
        <Form.Dropdown.Item
          value={TransactionFlagColor.Purple}
          title="Purple"
          icon={{ source: Icon.Dot, tintColor: Color.Purple }}
        />
      </Form.Dropdown>
    </Form>
  );
}
