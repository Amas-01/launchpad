import { FieldErrors, Controller, Control } from "react-hook-form";
import { useTranslations } from "next-intl";
import { NumericInput } from "@/components/ui/NumericInput";
import { DeployFormData } from "../DeployForm";

interface StepProps {
    control: Control<DeployFormData>;
    errors: FieldErrors<DeployFormData>;
}

export const StepSupply = ({ control, errors }: StepProps) => {
    const t = useTranslations("deploy.supply");
    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="text-left">
                <h2 className="text-xl font-bold text-white mb-2">{t("title")}</h2>
                <p className="text-sm text-gray-400">{t("description")}</p>
            </div>

            <Controller
                name="initialSupply"
                control={control}
                render={({ field }) => (
                    <NumericInput
                        label={t("initialSupply")}
                        placeholder={t("initialSupplyPlaceholder")}
                        value={field.value}
                        onChange={field.onChange}
                        allowDecimals={false}
                        error={errors.initialSupply?.message as string}
                    />
                )}
            />

            <Controller
                name="maxSupply"
                control={control}
                render={({ field }) => (
                    <NumericInput
                        label={t("maxSupply")}
                        placeholder={t("maxSupplyPlaceholder")}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        allowDecimals={false}
                        error={errors.maxSupply?.message as string}
                    />
                )}
            />
        </div>
    );
};
