import React from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import ThemedSwitch from '@components/input/ThemedSwitch'
import SectionTitle from '@components/text/SectionTitle'
import { AppSettings } from '@lib/constants/GlobalValues'
import { useMMKVBoolean } from '@lib/storage/MMKV'

const SimpleModeSettings = () => {
    const { t } = useTranslation()
    const [simpleMode, setSimpleMode] = useMMKVBoolean(AppSettings.SimpleMode)
    return (
        <View style={{ rowGap: 8 }}>
            <SectionTitle>{t('plus.simpleMode.title')}</SectionTitle>
            <ThemedSwitch
                label={t('plus.simpleMode.label')}
                description={t('plus.simpleMode.description')}
                value={simpleMode}
                onChangeValue={setSimpleMode}
            />
        </View>
    )
}

export default SimpleModeSettings
