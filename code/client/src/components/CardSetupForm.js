import {
  PaymentElement, useElements, useStripe
} from "@stripe/react-stripe-js";
import React, { useState } from "react";
import SignupComplete from "./SignupComplete";
  
  const CardSetupForm = (props) => {
    const { selected, mode, details, customerId, learnerEmail, learnerName, onSuccessfulConfirmation } =
      props;
    const [paymentSucceeded, setPaymentSucceeded] = useState(false);
    const [isFormComplete, setIsFormComplete] = useState(false);
    const [error, setError] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [last4, setLast4] = useState("");
    const stripe = useStripe();
    const elements = useElements();
  
    const handleClick = async (e) => {
      if(!stripe || !elements) return;
      setProcessing(true);

      const {error, setupIntent} = await stripe.confirmSetup({
        elements,
        confirmParams: {
          payment_method_data: {
            billing_details: {
              name: learnerName,
              email: learnerEmail
            }
          }
        },
        redirect: "if_required"
      })
      if(error) {
        if(error.code === 'card_declined') {
          setError('Your card has been declined.');
        } else if(error.code === 'setup_intent_authentication_failure') {
          setError('We are unable to authenticate your payment method. Please choose a different payment method and try again.');
        }

        setProcessing(false);
        return;
      };

      const paymentMethodId = setupIntent.payment_method;
      const response = await fetch(`/lessons`, {
        method: "POST",
        body: JSON.stringify({ id: customerId, paymentMethodId }),
        headers: {
          'Content-Type': 'application/json'
        }
      }).catch(error => console.log(error));
      const { lastFour } = await response.json();
      setLast4(lastFour);

      setProcessing(false);
      setPaymentSucceeded(true);
      onSuccessfulConfirmation && onSuccessfulConfirmation()
    };
  
    if (selected === -1) return null;
    if (paymentSucceeded) return (
      <div className={`lesson-form`}>
        <SignupComplete
          active={paymentSucceeded}
          email={learnerEmail}
          last4={last4}
          customer_id={customerId}
        />
      </div>
    )
    return (
      // The actual checkout form, inside the !paymentSucceeded clause
        <div className={`lesson-form`}>
            <div className={`lesson-desc`}>
              <h3>Registration details</h3>
              <div id="summary-table" className="lesson-info">
                {details}
              </div>
              <div className="lesson-legal-info">
                Your card will not be charged. By registering, you hold a session
                slot which we will confirm within 24 hrs.
              </div>
              <div className="lesson-grid">
                <div className="lesson-inputs">
                  <div className="lesson-input-box first">
                    <span>{learnerName} ({learnerEmail})</span>
                  </div>
                  <div className="lesson-payment-element">
                    {
                      processing ?
                        <div className="spinner" id="spinner"></div> : null
                    }
                    <PaymentElement onChange={e => setIsFormComplete(e.complete)}/>
                    <button disabled={processing || !isFormComplete} onClick={() => handleClick()} id="submit">
                      <span>
                        {processing ? 'Proccessing...' : 'Confirm Setup'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
              {error && (
                <div className="sr-field-error" id="card-errors" role="alert">
                  <div className="card-error" role="alert">
                    {error}
                  </div>
                </div>
              )}
            </div>
        </div>
    )
  };
  export default CardSetupForm;
  
