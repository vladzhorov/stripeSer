import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import React, { useEffect, useState } from "react";
import CardSetupForm from "./CardSetupForm";

const UpdateCustomer = ({
  customerId,
  customerName,
  customerEmail,
  onSuccessfulConfirmation,
}) => {
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState("");
  const [oldEmail, setOldEmail] = useState("");
  const [oldName, setOldName] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [stripePromise, setStripePromise] = useState(null);
  const [stripeOptions, setStripeOptions] = useState(null);
  const [paymentElementLoaded, setpaymentElementLoaded] = useState(false);
  const selected = 1;

  //Get info to load page, User payment information, config API route in package.json "proxy"
  useEffect(() => {
    setEmail(customerEmail);
    setName(customerName);
    setOldEmail(customerEmail);
    setOldName(customerName);
    if (email !== "" && name !== "") {
      setProcessing(false);
    }
    async function setUp() {
      const { key } = await fetch("/config").then((res) => res.json());
      setStripePromise(loadStripe(key));
    }
    setUp();
  }, []);

  const handleClick = async () => {
    try {
      setProcessing(true);
      const response = await fetch("/create-setup-intent", {
        method: "GET"
      });

      const { clientSecret } = await response.json();


      if (!clientSecret) {
        throw new Error("Не удалось создать Setup Intent");
      }
      const responseClientUpdate = await fetch(`/account-update/${customerId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name, email })
      })
      if (!responseClientUpdate.ok) {
        const errorData = await responseClientUpdate.json();
        setError(errorData.error);
      } else {
        const { updatedName, updatedEmail } = await responseClientUpdate.json();
        setName(updatedName);
        setEmail(updatedEmail)
        setStripeOptions({ clientSecret });
        setpaymentElementLoaded(true);
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="lesson-form">
      {!paymentElementLoaded ? (
        <div className="lesson-desc">
          <h3>Update your Payment details</h3>
          <div className="lesson-info">
            Fill out the form below if you'd like to us to use a new card.
          </div>
          <div className="lesson-grid">
            <div className="lesson-inputs">
              <div className="lesson-input-box">
                <input
                  type="text"
                  id="name"
                  placeholder="Name"
                  autoComplete="cardholder"
                  className="sr-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="lesson-input-box">
                <input
                  type="text"
                  id="email"
                  placeholder="Email"
                  autoComplete="cardholder"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            {error ? (
              <div id="card-errors">
                <div
                  className="sr-field-error"
                  id="customer-exists-error"
                  role="alert"
                >
                  {error}
                </div>
              </div>
            ) : null}
          </div>
          
          <button
            id="checkout-btn"
            disabled={processing}
            onClick={handleClick}
          >
            {processing ? (
              <div className="spinner" id="spinner"></div>
            ) : (
              <span id="button-text">Update Payment Method</span>
            )}
          </button>
        
          <div className="lesson-legal-info">
            Your card will not be charged. By registering, you hold a session
            slot which we will confirm within 24 hrs.
          </div>
        </div>
      ) : (
        <Elements stripe={stripePromise} options={stripeOptions}>
          <CardSetupForm
            selected={selected}
            mode="update"
            learnerEmail={email}
            learnerName={name}
            customerId={customerId}
            onSuccessfulConfirmation={onSuccessfulConfirmation}
          />
        </Elements>
      )}
    </div>
  );
};
export default UpdateCustomer;
